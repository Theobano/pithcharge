import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExpired, monthsToEnsure, parsePartitionBounds } from '../src/partitions';

test('parses range bounds and ignores DEFAULT', () => {
  const b = parsePartitionBounds("FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2026-02-01 00:00:00')");
  assert.equal(b?.from.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(b?.to.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(parsePartitionBounds('DEFAULT'), null);
});

test('monthsToEnsure rolls over the year', () => {
  const months = monthsToEnsure(new Date('2026-11-15T10:00:00Z'), 3).map((d) => d.toISOString().slice(0, 10));
  assert.deepEqual(months, ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
});

test('isExpired only when the whole partition is older than retention', () => {
  const at = new Date('2026-06-15T00:00:00Z');
  assert.equal(isExpired({ to: new Date('2026-02-01T00:00:00Z') }, 90, at), true);
  assert.equal(isExpired({ to: new Date('2026-04-01T00:00:00Z') }, 90, at), false);
});
