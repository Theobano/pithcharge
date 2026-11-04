import { test } from 'node:test';
import * as assert from 'node:assert';
import { evaluateAbacPolicy, SystemUser } from '../src/plugins/security.js';
import { ResourceAttributes } from '../src/types/index.js';

const resource: ResourceAttributes = {
  stationId: 'station-1',
  isOnline: true,
  connectorStatus: 'Available',
  ownerOrganizationId: 'org-1',
};

function user(organizationRole: string): SystemUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
    organizationRole,
  };
}

test('organization auditors can read but cannot control stations', () => {
  const auditor = user('auditor');

  assert.equal(
    evaluateAbacPolicy('station:Read', auditor, false, resource).allowed,
    true,
  );
  assert.deepEqual(
    evaluateAbacPolicy('station:Write', auditor, false, resource),
    { allowed: false, reason: 'Auditors have view-only access.' },
  );
});

test('only organization administrators can manage organization members', () => {
  assert.equal(
    evaluateAbacPolicy('organization:ManageMembers', user('admin'), false, resource).allowed,
    true,
  );
  assert.equal(
    evaluateAbacPolicy('organization:ManageMembers', user('user'), false, resource).allowed,
    false,
  );
});

test('anonymous users cannot issue station control commands', () => {
  assert.equal(
    evaluateAbacPolicy('station:Write', user('user'), true, resource).allowed,
    false,
  );
});
