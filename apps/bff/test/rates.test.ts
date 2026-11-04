import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPricingSnapshot,
  computeCharge,
  isValidTimezone,
  resolveRate,
  type RuleLike,
} from '../src/services/rate-engine.service';

const policy = { timezone: 'UTC', ratePerKwh: 0.3, ratePerMinute: 0, sessionFee: 1, idleFeePerMinute: 0.1 };

function rule(overrides: Partial<RuleLike>): RuleLike {
  return {
    id: 'r1', name: 'Rule', priority: 0, active: true, daysOfWeek: [], startTime: null, endTime: null,
    stationIds: [], validFrom: null, validUntil: null, ratePerKwh: 0.1, ratePerMinute: null,
    sessionFee: null, idleFeePerMinute: null, ...overrides,
  };
}

test('falls back to the base rate when no rule matches', () => {
  const snapshot = buildPricingSnapshot(policy, [rule({ startTime: '22:00', endTime: '06:00' })]);
  const { rule: matched, rates } = resolveRate(snapshot, new Date('2026-01-05T12:00:00Z'), 'S1');
  assert.equal(matched, null);
  assert.equal(rates.ratePerKwh, 0.3);
});

test('day/night bands, with the general price overriding the CSMS tariff', () => {
  const csms = { pricePerKwh: 0.9, pricePerMinute: 0, pricePerSession: 0 };
  const bands = [
    rule({ id: 'day', startTime: '07:00', endTime: '18:00', ratePerKwh: 0.4 }),
    rule({ id: 'night', startTime: '18:00', endTime: '07:00', ratePerKwh: 0.2 }),
  ];
  const snapshot = buildPricingSnapshot({ ...policy, ratePerKwh: 0.3 }, bands, csms);
  assert.equal(snapshot.source, 'policy');
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T12:00:00Z'), 'S1').rates.ratePerKwh, 0.4);
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T20:00:00Z'), 'S1').rates.ratePerKwh, 0.2);
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T05:00:00Z'), 'S1').rates.ratePerKwh, 0.2);
});

test('uses the CSMS tariff when no general price is set', () => {
  const csms = { pricePerKwh: 0.9, pricePerMinute: 0.01, pricePerSession: 2 };
  const snapshot = buildPricingSnapshot({ ...policy, ratePerKwh: null, ratePerMinute: null, sessionFee: null }, [], csms);
  assert.equal(snapshot.source, 'csms');
  const { rates } = resolveRate(snapshot, new Date('2026-01-05T12:00:00Z'), 'S1');
  assert.equal(rates.ratePerKwh, 0.9);
  assert.equal(rates.ratePerMinute, 0.01);
  assert.equal(rates.sessionFee, 2);
});

test('matches overnight windows and honours priority', () => {
  const snapshot = buildPricingSnapshot(policy, [
    rule({ id: 'night', name: 'Night', startTime: '22:00', endTime: '06:00', ratePerKwh: 0.1 }),
    rule({ id: 'promo', name: 'Promo', priority: 5, startTime: '23:00', endTime: '01:00', ratePerKwh: 0.05 }),
  ]);
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T23:30:00Z'), 'S1').rule?.id, 'promo');
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T03:00:00Z'), 'S1').rule?.id, 'night');
});

test('evaluates windows in the policy timezone', () => {
  const snapshot = buildPricingSnapshot({ ...policy, timezone: 'America/New_York' }, [
    rule({ startTime: '00:00', endTime: '06:00' }),
  ]);
  // 03:00 UTC is 22:00 in New York the previous day, outside the window.
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T03:00:00Z'), 'S1').rule, null);
  assert.ok(resolveRate(snapshot, new Date('2026-01-05T07:00:00Z'), 'S1').rule);
});

test('day and station filters apply', () => {
  const snapshot = buildPricingSnapshot(policy, [rule({ daysOfWeek: [0, 6], stationIds: ['S1'] })]);
  // 2026-01-04 is a Sunday, 2026-01-05 a Monday.
  assert.ok(resolveRate(snapshot, new Date('2026-01-04T10:00:00Z'), 'S1').rule);
  assert.equal(resolveRate(snapshot, new Date('2026-01-04T10:00:00Z'), 'S2').rule, null);
  assert.equal(resolveRate(snapshot, new Date('2026-01-05T10:00:00Z'), 'S1').rule, null);
});

test('splits energy across rate windows', () => {
  const snapshot = buildPricingSnapshot(policy, [
    rule({ startTime: '00:00', endTime: '01:00', ratePerKwh: 0.1, sessionFee: 0 }),
  ]);
  const charge = computeCharge({
    snapshot,
    stationId: 'S1',
    startTime: new Date('2026-01-05T00:00:00Z'),
    endTime: new Date('2026-01-05T02:00:00Z'),
    totalKwh: 20,
  });
  // 10 kWh at 0.10 + 10 kWh at 0.30, session fee taken from the rule active at start (0).
  assert.equal(charge.total.toString(), '4');
  assert.equal(charge.lines.length, 2);
});

test('adds time and idle fees', () => {
  const snapshot = buildPricingSnapshot({ ...policy, ratePerMinute: 0.02 }, []);
  const charge = computeCharge({
    snapshot,
    stationId: 'S1',
    startTime: new Date('2026-01-05T10:00:00Z'),
    endTime: new Date('2026-01-05T11:00:00Z'),
    totalKwh: 10,
    idleMinutes: 10,
  });
  // 3.00 energy + 1.20 time + 1.00 session + 1.00 idle
  assert.equal(charge.total.toString(), '6.2');
});

test('validates timezones', () => {
  assert.equal(isValidTimezone('Europe/London'), true);
  assert.equal(isValidTimezone('Mars/Base'), false);
});
