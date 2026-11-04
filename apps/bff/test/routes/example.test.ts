import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'

test('root route is loaded', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/'
  })

  assert.deepEqual(res.json(), { root: true })
})
