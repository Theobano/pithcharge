import { test } from 'node:test'
import * as assert from 'node:assert'
import { emailFrom, emailProvider, emailSettings, renderEmail } from '@pithcharge/notifications'

const KEYS = ['EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_PASSWORD', 'NOTIFICATION_EMAIL_WEBHOOK_URL', 'NOTIFICATION_EMAIL_WEBHOOK_SECRET', 'EMAIL_FROM']

function withEnv(values: Record<string, string>, run: () => void) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
  KEYS.forEach((key) => delete process.env[key])
  Object.assign(process.env, values)
  try {
    run()
  } finally {
    KEYS.forEach((key) => (saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key])))
  }
}

test('email provider is chosen from the environment', () => {
  withEnv({}, () => assert.equal(emailProvider(), 'none'))
  withEnv({ SMTP_HOST: 'smtp.example.com' }, () => assert.equal(emailProvider(), 'smtp'))
  withEnv(
    { NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://relay.example.com', NOTIFICATION_EMAIL_WEBHOOK_SECRET: 's' },
    () => assert.equal(emailProvider(), 'webhook'),
  )
  withEnv({ EMAIL_PROVIDER: 'none', SMTP_HOST: 'smtp.example.com' }, () => assert.equal(emailProvider(), 'none'))
})

test('email settings never expose secrets', () => {
  withEnv({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_PASSWORD: 'hunter2', EMAIL_FROM: 'a@b.co' }, () => {
    const settings = emailSettings()
    assert.equal(settings.smtp?.secure, true)
    assert.equal(emailFrom(), 'Pithcharge <a@b.co>')
    assert.ok(!JSON.stringify(settings).includes('hunter2'))
  })
})

test('rendered emails escape user-controlled text', () => {
  const { html, text } = renderEmail({ heading: '<b>Hi</b>', body: 'a & b', action: { label: 'Go', url: 'https://x.co/?a=1&b="2"' } })
  assert.ok(!html.includes('<b>Hi</b>'))
  assert.ok(html.includes('a &amp; b'))
  assert.ok(html.includes('&quot;2&quot;'))
  assert.ok(text.includes('https://x.co/'))
})
