import { test } from 'node:test'
import * as assert from 'node:assert'
import { selectBillingStrategy } from '../src/services/charging/index.js'
import { concurrentSessionsAllowed, liveSessionFilter, PENDING_SESSION_TTL_MS } from '../src/services/charging/policy.js'
import { resolveChargingTarget } from '../src/services/charging/target.js'
import { ChargingStartError } from '../src/services/charging/types.js'

test('billing follows the active organization; anonymous accounts are always public', () => {
  assert.equal(selectBillingStrategy({ userId: 'u', isAnonymous: false, organizationId: 'org' }).name, 'organization')
  assert.equal(selectBillingStrategy({ userId: 'u', isAnonymous: false }).name, 'public')
  assert.equal(selectBillingStrategy({ userId: 'u', isAnonymous: true, organizationId: 'org' }).name, 'public')
})

test('only anonymous accounts are denied concurrent sessions', () => {
  assert.equal(concurrentSessionsAllowed(true), false)
  assert.equal(concurrentSessionsAllowed(false), true)
})

test('pending sessions expire from the live-session filter', () => {
  const now = 1_000_000_000_000
  const filter = liveSessionFilter(now)
  assert.deepStrictEqual(filter.OR![1]!.startTime!.gte, new Date(now - PENDING_SESSION_TTL_MS))
})

test('resolveChargingTarget validates station, evse and connector', () => {
  const station = {
    id: 's1',
    isOnline: true,
    evses: [{ evseId: 1, connectors: [
      { connectorId: 1, status: 'Occupied' },
      { connectorId: 2, status: 'Available' },
    ] }],
  } as never
  assert.deepStrictEqual(resolveChargingTarget(station, 's1', 1), { stationId: 's1', evseId: 1, connectorId: 2 })
  const code = (fn: () => unknown) => {
    try { fn() } catch (error) { return (error as ChargingStartError).code }
  }
  assert.equal(code(() => resolveChargingTarget(station, 's1', 1, 1)), 'CONNECTOR_UNAVAILABLE')
  assert.equal(code(() => resolveChargingTarget(station, 's1', 9)), 'EVSE_NOT_FOUND')
  assert.equal(code(() => resolveChargingTarget(null, 's1', 1)), 'STATION_NOT_FOUND')
  assert.equal(code(() => resolveChargingTarget({ ...(station as object), isOnline: false } as never, 's1', 1)), 'STATION_OFFLINE')
})
