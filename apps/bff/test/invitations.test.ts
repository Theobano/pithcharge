import { test } from 'node:test'
import * as assert from 'node:assert'
import { canControlSession, canViewSession, sessionScope } from '../src/services/charging/sessions'
import { getPublicNetworkOrganizationId } from '../src/services/public-network.service'
import {
  InvitationError,
  acceptInvitation,
  buildInviteLink,
  invitationState,
  normalizeEmail,
} from '../src/services/invitation.service'

const session = (organizationId: string | null, userId = 'u1') => ({ userId, organizationId }) as never

test('sessions are scoped to the active organization, or to public mode when none is active', async () => {
  const publicId = await getPublicNetworkOrganizationId()
  assert.deepStrictEqual(await sessionScope({ id: 'u1', organizationId: 'org' }), { userId: 'u1', organizationId: 'org' })
  assert.deepStrictEqual(await sessionScope({ id: 'u1' }), {
    userId: 'u1',
    OR: [{ organizationId: null }, { organizationId: publicId }],
  })

  assert.equal(await canViewSession({ id: 'u1', organizationId: 'org' }, session('org')), true)
  assert.equal(await canViewSession({ id: 'u1', organizationId: 'org' }, session(null)), false)
  assert.equal(await canViewSession({ id: 'u1' }, session(null)), true)
  assert.equal(await canViewSession({ id: 'u1' }, session(publicId)), true)
  assert.equal(await canViewSession({ id: 'u1' }, session('org')), false)
  assert.equal(await canControlSession({ id: 'u2', organizationId: 'org' }, session('org')), false)
})

test('invitation state reports expiry and builds links from WEB_APP_URL', () => {
  const past = new Date(Date.now() - 1000)
  const future = new Date(Date.now() + 60_000)
  assert.equal(invitationState({ status: 'pending', expiresAt: past }), 'expired')
  assert.equal(invitationState({ status: 'pending', expiresAt: future }), 'pending')
  assert.equal(invitationState({ status: 'accepted', expiresAt: past }), 'accepted')

  process.env.WEB_APP_URL = 'https://app.example.com/'
  assert.equal(buildInviteLink('abc'), 'https://app.example.com/invite/abc')
  assert.equal(normalizeEmail('  A@B.Com '), 'a@b.com')
})

test('malformed invitation ids are rejected as not found without touching the database', async () => {
  await assert.rejects(
    () => acceptInvitation('not-a-uuid', { id: 'u1', email: 'a@b.com' }),
    (error: unknown) => error instanceof InvitationError && error.code === 'INVITATION_NOT_FOUND',
  )
})
