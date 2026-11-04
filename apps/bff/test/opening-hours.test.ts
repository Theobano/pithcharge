import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOpenStatus, normalizeOpeningHours } from '@pithcharge/cms-adapters';

const weekdays = (begin: string, end: string, days = [1, 2, 3, 4, 5]) =>
  days.map((weekday) => ({ weekday, periodBegin: begin, periodEnd: end }));

test('normalizeOpeningHours rejects empty or malformed input', () => {
  assert.equal(normalizeOpeningHours(null), undefined);
  assert.equal(normalizeOpeningHours('nope'), undefined);
  assert.equal(normalizeOpeningHours({ twentyfourSeven: false, regularHours: [{ weekday: 9, periodBegin: '08:00', periodEnd: '10:00' }] }), undefined);
  assert.equal(normalizeOpeningHours({ twentyfourSeven: true })?.twentyfourSeven, true);
});

test('regular hours are evaluated in the hub time zone', () => {
  const hours = normalizeOpeningHours({ twentyfourSeven: false, regularHours: weekdays('08:00', '18:00') });
  // Mon 2026-06-01 09:00 Lagos (UTC+1) == 08:00 UTC
  assert.equal(getOpenStatus(hours, 'Africa/Lagos', new Date('2026-06-01T08:00:00Z'))?.isOpen, true);
  // Same instant in New York is 04:00 local
  assert.equal(getOpenStatus(hours, 'America/New_York', new Date('2026-06-01T08:00:00Z'))?.isOpen, false);
  // Saturday is closed
  assert.equal(getOpenStatus(hours, 'UTC', new Date('2026-06-06T12:00:00Z'))?.isOpen, false);
});

test('overnight periods spill into the next day', () => {
  const hours = normalizeOpeningHours({ twentyfourSeven: false, regularHours: weekdays('22:00', '04:00', [5]) });
  assert.equal(getOpenStatus(hours, 'UTC', new Date('2026-06-05T23:00:00Z'))?.isOpen, true);
  assert.equal(getOpenStatus(hours, 'UTC', new Date('2026-06-06T03:00:00Z'))?.isOpen, true);
  assert.equal(getOpenStatus(hours, 'UTC', new Date('2026-06-06T05:00:00Z'))?.isOpen, false);
});

test('24/7 hubs are open unless an exceptional closing applies', () => {
  const hours = normalizeOpeningHours({
    twentyfourSeven: true,
    exceptionalClosings: [{ periodBegin: '2026-12-25T00:00:00Z', periodEnd: '2026-12-26T00:00:00Z' }],
  });
  assert.deepEqual(getOpenStatus(hours, 'UTC', new Date('2026-06-01T12:00:00Z')), { isOpen: true, alwaysOpen: true });
  assert.equal(getOpenStatus(hours, 'UTC', new Date('2026-12-25T12:00:00Z'))?.isOpen, false);
});

test('exceptional openings override regular closure and missing hours yield undefined', () => {
  const hours = normalizeOpeningHours({
    twentyfourSeven: false,
    regularHours: weekdays('08:00', '18:00'),
    exceptionalOpenings: [{ periodBegin: '2026-06-06T10:00:00Z', periodEnd: '2026-06-06T14:00:00Z' }],
  });
  assert.equal(getOpenStatus(hours, 'UTC', new Date('2026-06-06T12:00:00Z'))?.isOpen, true);
  assert.equal(getOpenStatus(undefined), undefined);
});
