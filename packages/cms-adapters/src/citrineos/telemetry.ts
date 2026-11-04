import type { TelemetrySample } from "../types";

interface SampledValue {
  value?: number | string;
  measurand?: string;
  unit?: string;
  phase?: string;
  unitOfMeasure?: { unit?: string; multiplier?: number };
}

interface MeterValueRow {
  timestamp: string;
  sampledValue: unknown;
}

const ENERGY = "Energy.Active.Import.Register";
const POWER = "Power.Active.Import";
const CURRENT = "Current.Import";
const VOLTAGE = "Voltage";
const SOC = "SoC";

function unitOf(sample: SampledValue) {
  return sample.unit ?? sample.unitOfMeasure?.unit;
}

function numeric(sample: SampledValue) {
  const value = Number(sample.value);
  if (!Number.isFinite(value)) return undefined;
  const multiplier = sample.unitOfMeasure?.multiplier;
  return multiplier ? value * 10 ** multiplier : value;
}

function toKilo(sample: SampledValue) {
  const value = numeric(sample);
  if (value === undefined) return undefined;
  const unit = unitOf(sample);
  return unit === "kWh" || unit === "kW" ? value : value / 1000;
}

function samples(row: MeterValueRow): SampledValue[] {
  return Array.isArray(row.sampledValue) ? (row.sampledValue as SampledValue[]) : [];
}

// Prefer the aggregate (phase-less) sample when a measurand is reported per phase.
function pick(rows: MeterValueRow[], measurand: string) {
  for (const row of rows) {
    const matching = samples(row).filter(
      (sample) => sample.measurand === measurand || (!sample.measurand && measurand === ENERGY),
    );
    if (matching.length === 0) continue;
    return { row, sample: matching.find((sample) => !sample.phase) ?? matching[0]! };
  }
  return undefined;
}

/** Builds a telemetry snapshot from meter-value rows ordered newest first. */
export function parseTelemetry(rows: MeterValueRow[] | undefined): TelemetrySample | undefined {
  if (!rows?.length) return undefined;
  const energy = pick(rows, ENERGY);
  const power = pick(rows, POWER);
  const current = pick(rows, CURRENT);
  const voltage = pick(rows, VOLTAGE);
  const soc = pick(rows, SOC);

  return {
    timestamp: rows[0]!.timestamp,
    energyKwh: energy ? toKilo(energy.sample) ?? 0 : 0,
    powerKw: power ? toKilo(power.sample) : undefined,
    currentAmps: current ? numeric(current.sample) : undefined,
    voltage: voltage ? numeric(voltage.sample) : undefined,
    socPercent: soc ? numeric(soc.sample) : undefined,
  };
}
