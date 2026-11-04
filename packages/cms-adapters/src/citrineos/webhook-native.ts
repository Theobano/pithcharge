/** Thrown for valid CitrineOS subscription messages that billing does not need. */
export class IgnoredWebhookEvent extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IgnoredWebhookEvent';
  }
}

export type NativeEventType =
  | 'TransactionStarted'
  | 'TransactionEnded'
  | 'MeterValues'
  | 'StatusNotification'
  | 'Heartbeat';

export interface NativeWebhookEvent {
  eventType: NativeEventType;
  stationId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** True for bodies posted by CitrineOS message subscriptions (WebhookDispatcher). */
export function isNativeSubscriptionBody(body: Record<string, unknown>): boolean {
  return typeof body.ocppConnectionName === 'string' && typeof body.event === 'string';
}

function toKwh(sample: Record<string, unknown>): number | undefined {
  const raw = Number(sample.value);
  if (!Number.isFinite(raw)) return undefined;
  const unit = asRecord(sample.unitOfMeasure);
  const multiplier = typeof unit?.multiplier === 'number' ? unit.multiplier : 0;
  const scaled = raw * 10 ** multiplier;
  return unit?.unit === 'kWh' ? scaled : scaled / 1000;
}

/** Latest energy-register reading (kWh) from OCPP 2.0.1 or 1.6 meter values. */
function latestEnergyKwh(meterValues: unknown): number | undefined {
  if (!Array.isArray(meterValues)) return undefined;
  let latest: { at: number; kwh: number } | undefined;
  for (const entry of meterValues) {
    const meter = asRecord(entry);
    const samples = Array.isArray(meter?.sampledValue) ? meter.sampledValue : [];
    const at = Date.parse(String(meter?.timestamp ?? '')) || 0;
    for (const sampleValue of samples) {
      const sample = asRecord(sampleValue);
      if (!sample) continue;
      const measurand = sample.measurand ?? 'Energy.Active.Import.Register';
      if (measurand !== 'Energy.Active.Import.Register') continue;
      const kwh = toKwh(
        // OCPP 1.6 carries the unit as a plain string
        typeof sample.unit === 'string' && !sample.unitOfMeasure
          ? { ...sample, unitOfMeasure: { unit: sample.unit } }
          : sample,
      );
      if (kwh === undefined) continue;
      if (!latest || at >= latest.at) latest = { at, kwh };
    }
  }
  return latest?.kwh;
}

function compact(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/**
 * Translates a CitrineOS message-subscription body
 * ({ ocppConnectionName, event, message, info }) into the adapter's billing events.
 */
export function translateNativeSubscription(body: Record<string, unknown>): NativeWebhookEvent {
  const stationId = String(body.ocppConnectionName).trim();
  if (!stationId) throw new Error('CitrineOS webhook is missing ocppConnectionName.');
  if (body.event !== 'message') throw new IgnoredWebhookEvent(`Connection event "${String(body.event)}" ignored.`);
  if (typeof body.message !== 'string') throw new Error('CitrineOS webhook is missing the OCPP message.');

  let frame: unknown;
  try {
    frame = JSON.parse(body.message);
  } catch {
    throw new Error('CitrineOS webhook OCPP message is not valid JSON.');
  }
  // Only station-initiated calls: [2, messageId, action, payload]
  if (!Array.isArray(frame) || frame[0] !== 2 || typeof frame[2] !== 'string') {
    throw new IgnoredWebhookEvent('Not an OCPP call.');
  }
  const action = frame[2];
  const data = asRecord(frame[3]) ?? {};
  const info = asRecord(body.info) ?? {};
  const correlationId = typeof info.correlationId === 'string' ? info.correlationId : String(frame[1]);
  const infoTimestamp = typeof info.timestamp === 'string' ? info.timestamp : undefined;
  const timestampOf = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? value
      : (infoTimestamp ?? new Date().toISOString());
  const base = { stationId, correlationId };

  switch (action) {
    case 'Heartbeat':
      return {
        eventType: 'Heartbeat',
        stationId,
        timestamp: timestampOf(undefined),
        payload: { ...base },
      };
    case 'StatusNotification':
      return {
        eventType: 'StatusNotification',
        stationId,
        timestamp: timestampOf(data.timestamp),
        payload: compact({
          ...base,
          evseId: data.evseId,
          connectorId: data.connectorId,
          status: data.connectorStatus ?? data.status,
        }),
      };
    case 'TransactionEvent': {
      const transactionInfo = asRecord(data.transactionInfo);
      const evse = asRecord(data.evse);
      const transactionId = transactionInfo?.transactionId;
      if (typeof transactionId !== 'string' || !transactionId) {
        throw new Error('CitrineOS TransactionEvent is missing transactionId.');
      }
      const idToken = asRecord(data.idToken);
      const energy = latestEnergyKwh(data.meterValue);
      const common = {
        ...base,
        transactionId,
        evseId: evse?.id,
        connectorId: evse?.connectorId,
        idToken: typeof idToken?.idToken === 'string' ? idToken.idToken : undefined,
      };
      const timestamp = timestampOf(data.timestamp);
      switch (data.eventType) {
        case 'Started':
          return {
            eventType: 'TransactionStarted',
            stationId,
            timestamp,
            payload: compact({ ...common, meterStartKwh: energy }),
          };
        case 'Ended':
          return {
            eventType: 'TransactionEnded',
            stationId,
            timestamp,
            payload: compact({ ...common, meterStopKwh: energy }),
          };
        default:
          if (energy === undefined) throw new IgnoredWebhookEvent('TransactionEvent without energy reading.');
          return {
            eventType: 'MeterValues',
            stationId,
            timestamp,
            payload: compact({ ...common, currentMeterKwh: energy }),
          };
      }
    }
    // OCPP 1.6 messages that carry a transactionId
    case 'StopTransaction': {
      const meterStop = Number(data.meterStop);
      return {
        eventType: 'TransactionEnded',
        stationId,
        timestamp: timestampOf(data.timestamp),
        payload: compact({
          ...base,
          transactionId: data.transactionId === undefined ? undefined : String(data.transactionId),
          idToken: typeof data.idTag === 'string' ? data.idTag : undefined,
          meterStopKwh: Number.isFinite(meterStop) ? meterStop / 1000 : undefined,
        }),
      };
    }
    case 'MeterValues': {
      const energy = latestEnergyKwh(data.meterValue);
      if (data.transactionId === undefined || energy === undefined) {
        throw new IgnoredWebhookEvent('MeterValues outside a transaction.');
      }
      return {
        eventType: 'MeterValues',
        stationId,
        timestamp: timestampOf(undefined),
        payload: compact({
          ...base,
          transactionId: String(data.transactionId),
          connectorId: data.connectorId,
          currentMeterKwh: energy,
        }),
      };
    }
    default:
      throw new IgnoredWebhookEvent(`OCPP action "${action}" is not used for billing.`);
  }
}
