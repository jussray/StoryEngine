import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCallerSelectedControlMode,
  isFounderControlRoomController,
  isInternalController,
} from '../lib/internalControl.js';

for (const body of [
  { mode: 'lindymode' },
  { mode_id: 'ooda' },
  { workflow: 'redteam' },
  { workflow_id: 'goalfix' },
  { command: '/ultrathink' },
  { skill: 'attackten' },
  { lens: 'l99' },
]) {
  test(`caller-selected control field is rejected: ${Object.keys(body)[0]}`, () => {
    assert.equal(hasCallerSelectedControlMode(body), true);
  });
}

test('ordinary outcome data does not become control-plane input', () => {
  assert.equal(hasCallerSelectedControlMode({
    recovery_action: 'resolved_in_writing_room',
    outcome: 'resolved',
  }), false);
});

test('browser sessions are never internal controllers even when administrator', () => {
  assert.equal(isInternalController({
    type: 'session',
    role: 'administrator',
  }), false);
});

test('scoped administrator service identity is an eligible generic internal controller', () => {
  assert.equal(isInternalController({
    type: 'scoped_api_key',
    role: 'administrator',
  }), true);
});

test('lower-privilege scoped keys cannot activate system-owned modes', () => {
  assert.equal(isInternalController({
    type: 'scoped_api_key',
    role: 'creator',
  }), false);
});

test('Founder Control Room product controller requires the authenticated FCR tenant', () => {
  assert.equal(isFounderControlRoomController({
    type: 'scoped_api_key',
    tenant_id: 'founder-control-room',
    role: 'administrator',
  }), true);

  assert.equal(isFounderControlRoomController({
    type: 'scoped_api_key',
    tenant_id: 'other-internal-service',
    role: 'administrator',
  }), false);

  assert.equal(isFounderControlRoomController({
    type: 'session',
    tenant_id: 'founder-control-room',
    role: 'administrator',
  }), false);
});
