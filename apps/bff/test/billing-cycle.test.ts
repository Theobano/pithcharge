import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cycleStart, defaultAnchor, dueCycles, type CycleSettings } from '../src/services/billing-cycle.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

function settings(overrides: Partial<CycleSettings>): CycleSettings {
  return {
    unit: 'MONTH',
    interval: 1,
    anchor: null,
    createdAt: new Date('2026-01-10T00:00:00Z'),
    cursor: null,
    ...overrides,
  };
}

test('default anchors align to calendar boundaries', () => {
  const created = new Date('2026-03-12T15:00:00Z'); // Thursday
  assert.equal(iso(defaultAnchor('DAY', created)), '2026-03-12');
  assert.equal(iso(defaultAnchor('WEEK', created)), '2026-03-09');
  assert.equal(iso(defaultAnchor('MONTH', created)), '2026-03-01');
});

test('monthly cycles from a month-end anchor do not drift', () => {
  const anchor = new Date('2026-01-31T00:00:00Z');
  assert.equal(iso(cycleStart(anchor, 'MONTH', 1, 1)), '2026-02-28');
  assert.equal(iso(cycleStart(anchor, 'MONTH', 1, 2)), '2026-03-31');
});

test('without a cursor billing starts at the last completed cycle', () => {
  const cycles = dueCycles(settings({}), new Date('2026-06-15T00:00:00Z'));
  assert.equal(cycles.length, 1);
  assert.equal(  iso(cycles[0]!.start), '2026-05-01');
    assert.equal(iso(cycles[0]!.end), '2026-06-01');
});

test('a policy created in the current cycle has nothing due yet', () => {
  const cycles = dueCycles(settings({ createdAt: new Date('2026-06-02T00:00:00Z') }), new Date('2026-06-15T00:00:00Z'));
  assert.equal(cycles.length, 0);
});

test('every n weeks cycles catch up from the cursor in order', () => {
  const cycles = dueCycles(
    settings({
      unit: 'WEEK',
      interval: 2,
      anchor: new Date('2026-01-05T00:00:00Z'),
      cursor: new Date('2026-01-05T00:00:00Z'),
    }),
    new Date('2026-02-20T00:00:00Z'),
  );
  assert.deepEqual(cycles.map((c) => iso(c.start)), ['2026-01-05', '2026-01-19', '2026-02-02']);
  assert.equal(iso(cycles[2]!.end), '2026-02-16');
});

test('daily cycles are due once the day has ended and are not repeated after the cursor advances', () => {
  const base = settings({ unit: 'DAY', createdAt: new Date('2026-06-01T08:00:00Z') });
  const first = dueCycles(base, new Date('2026-06-03T01:00:00Z'));
  assert.deepEqual(first.map((c) => iso(c.start)), ['2026-06-02']);
  const next = dueCycles({ ...base, cursor: first[0]!.end }, new Date('2026-06-03T01:00:00Z'));
  assert.equal(next.length, 0);
});

test('catch-up is capped per run', () => {
  const cycles = dueCycles(
    settings({ unit: 'DAY', anchor: new Date('2026-01-01T00:00:00Z'), cursor: new Date('2026-01-01T00:00:00Z') }),
    new Date('2026-06-01T00:00:00Z'),
    5,
  );
  assert.equal(cycles.length, 5);
});

test('changing the cycle re-bases from a cursor that is off the new grid', () => {
  const cycles = dueCycles(
    settings({
      unit: 'WEEK',
      anchor: new Date('2026-03-04T00:00:00Z'),
      cursor: new Date('2026-03-04T00:00:00Z'),
    }),
    new Date('2026-03-25T00:00:00Z'),
  );
  assert.deepEqual(cycles.map((c) => iso(c.start)), ['2026-03-04', '2026-03-11', '2026-03-18']);
});
