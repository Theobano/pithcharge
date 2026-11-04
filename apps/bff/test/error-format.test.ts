import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from './helper'
import { normalizeErrorBody } from '../src/plugins/error-format'

function assertShape(body: unknown) {
  assert.ok(body && typeof body === 'object')
  const { code, message } = body as { code?: unknown; message?: unknown }
  assert.equal(typeof code, 'string')
  assert.ok((code as string).length > 0)
  assert.equal(typeof message, 'string')
  assert.ok((message as string).length > 0)
  assert.equal('error' in (body as object), false)
}

test('normalizeErrorBody converts legacy and malformed bodies', () => {
  assert.deepStrictEqual(normalizeErrorBody(404, { error: 'Nope' }), { code: 'NOT_FOUND', message: 'Nope' })
  assert.deepStrictEqual(
    normalizeErrorBody(409, { error: 'Busy', code: 'CONNECTOR_RESERVED' }),
    { code: 'CONNECTOR_RESERVED', message: 'Busy' },
  )
  assert.deepStrictEqual(
    normalizeErrorBody(402, { success: false, error: 'Declined', status: 'FAILED' }),
    { code: 'PAYMENT_REQUIRED', message: 'Declined', success: false, status: 'FAILED' },
  )
  assertShape(normalizeErrorBody(500, null))
  assertShape(normalizeErrorBody(400, 'plain text'))
  assertShape(normalizeErrorBody(400, { error: { nested: true } }))
})

test('error responses share the { code, message } shape', async (t) => {
  const app = await build(t)

  const cases: Array<{ method: 'GET' | 'POST'; url: string; payload?: object; status: number }> = [
    { method: 'GET', url: '/api/v1/does-not-exist', status: 404 },
    { method: 'GET', url: '/api/v1/billing/me', status: 401 },
    { method: 'GET', url: '/api/v1/notifications', status: 401 },
    { method: 'POST', url: '/api/v1/stations/abc/remote-start', payload: { evseId: 1 }, status: 401 },
    { method: 'GET', url: '/api/v1/hubs/map?zoom=abc', status: 400 },
    { method: 'POST', url: '/api/v1/webhooks/citrineos', payload: {}, status: 401 },
  ]

  for (const item of cases) {
    const res = await app.inject({ method: item.method, url: item.url, payload: item.payload })
    assert.ok(res.statusCode >= 400, `${item.url} returned ${res.statusCode}`)
    assertShape(JSON.parse(res.payload))
  }
})
