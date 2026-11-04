import { test } from 'node:test';
import * as assert from 'node:assert';
import { parseDateRange, slugify, toCsv } from '../src/services/admin.service';

test('toCsv escapes delimiters and neutralizes spreadsheet formulas', () => {
  const csv = toCsv([{ a: 'x,y', b: '=SUM(A1)', c: 'say "hi"', d: null }], ['a', 'b', 'c', 'd']);
  assert.equal(csv, 'a,b,c,d\n"x,y",\'=SUM(A1),"say ""hi""",');
});

test('parseDateRange rejects inverted or invalid ranges', () => {
  assert.equal(parseDateRange({ from: '2025-02-01', to: '2025-01-01' }), null);
  assert.equal(parseDateRange({ from: 'nope' }), null);
  assert.ok(parseDateRange({}));
});

test('slugify produces url-safe slugs', () => {
  assert.equal(slugify('  Acme Fleet & Co.  '), 'acme-fleet-co');
});
