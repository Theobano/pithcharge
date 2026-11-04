import assert from 'node:assert/strict'
import test from 'node:test'
import { IgnoredWebhookEvent, isNativeSubscriptionBody, translateNativeSubscription } from '@pithcharge/cms-adapters'

const body = (action: string, payload: unknown, event = 'message') => ({
  ocppConnectionName: 'cp002',
  event,
  origin: 'cs',
  message: JSON.stringify([2, 'm1', action, payload]),
  info: { correlationId: 'c1', timestamp: '2026-11-04T10:00:00.000Z', action },
})

test('native bodies are recognised', () => {
  assert.equal(isNativeSubscriptionBody(body('Heartbeat', {})), true)
  assert.equal(isNativeSubscriptionBody({ action: 'Heartbeat', stationId: 'x' }), false)
})

test('TransactionEvent Started becomes TransactionStarted with the start meter in kWh', () => {
  const event = translateNativeSubscription(
    body('TransactionEvent', {
      eventType: 'Started',
      timestamp: '2026-11-04T10:00:01.000Z',
      transactionInfo: { transactionId: 'tx-1' },
      evse: { id: 1, connectorId: 1 },
      idToken: { idToken: 'TOKEN1', type: 'ISO14443' },
      meterValue: [{ timestamp: '2026-11-04T10:00:01.000Z', sampledValue: [{ value: 1500, measurand: 'Energy.Active.Import.Register' }] }],
    }),
  )
  assert.equal(event.eventType, 'TransactionStarted')
  assert.equal(event.stationId, 'cp002')
  assert.equal(event.payload.transactionId, 'tx-1')
  assert.equal(event.payload.idToken, 'TOKEN1')
  assert.equal(event.payload.meterStartKwh, 1.5)
  assert.equal(event.payload.evseId, 1)
})

test('TransactionEvent Updated and Ended map to meter values and end events', () => {
  const sample = { timestamp: '2026-11-04T10:30:00.000Z', sampledValue: [{ value: 3, unitOfMeasure: { unit: 'kWh' } }] }
  const updated = translateNativeSubscription(
    body('TransactionEvent', { eventType: 'Updated', timestamp: sample.timestamp, transactionInfo: { transactionId: 'tx-1' }, meterValue: [sample] }),
  )
  assert.equal(updated.eventType, 'MeterValues')
  assert.equal(updated.payload.currentMeterKwh, 3)
  const ended = translateNativeSubscription(
    body('TransactionEvent', { eventType: 'Ended', timestamp: sample.timestamp, transactionInfo: { transactionId: 'tx-1' }, meterValue: [sample] }),
  )
  assert.equal(ended.eventType, 'TransactionEnded')
  assert.equal(ended.payload.meterStopKwh, 3)
})

test('OCPP 1.6 StopTransaction converts Wh to kWh', () => {
  const event = translateNativeSubscription(
    body('StopTransaction', { transactionId: 42, meterStop: 12000, timestamp: '2026-11-04T11:00:00.000Z', idTag: 'TAG' }),
  )
  assert.equal(event.eventType, 'TransactionEnded')
  assert.equal(event.payload.transactionId, '42')
  assert.equal(event.payload.meterStopKwh, 12)
})

test('unrelated messages and connection events are ignored, malformed ones rejected', () => {
  assert.throws(() => translateNativeSubscription(body('BootNotification', {})), IgnoredWebhookEvent)
  assert.throws(() => translateNativeSubscription(body('Heartbeat', {}, 'connected')), IgnoredWebhookEvent)
  assert.throws(() => translateNativeSubscription({ ...body('Heartbeat', {}), message: 'nope' }), /not valid JSON/)
  assert.throws(
    () => translateNativeSubscription(body('TransactionEvent', { eventType: 'Started', transactionInfo: {} })),
    /missing transactionId/,
  )
})
