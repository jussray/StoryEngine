import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateProviderAuthority,
  loadRuntimeContract
} from '../deployment/providerAuthority.js';

const contract = loadRuntimeContract();

test('durable stateful container target is authorized', () => {
  const decision = evaluateProviderAuthority(contract, 'stateful-container-durable-volume');
  assert.equal(decision.authority, 'AUTHORIZED');
  assert.deepEqual(decision.reasons, []);
});

test('stateless worker target is rejected', () => {
  const decision = evaluateProviderAuthority(contract, 'stateless-worker');
  assert.equal(decision.authority, 'REJECTED');
  assert.ok(decision.reasons.some(reason => reason.includes('container-process')));
  assert.ok(decision.reasons.some(reason => reason.includes('durable-mounted-filesystem')));
  assert.ok(decision.reasons.some(reason => reason.includes('sqlite-file-persistence')));
});

test('container with ephemeral disk is rejected', () => {
  const decision = evaluateProviderAuthority(contract, 'container-ephemeral-disk');
  assert.equal(decision.authority, 'REJECTED');
  assert.ok(decision.reasons.some(reason => reason.includes('durable-mounted-filesystem')));
  assert.ok(decision.reasons.some(reason => reason.includes('sqlite-file-persistence')));
});

test('unknown provider target fails closed', () => {
  const decision = evaluateProviderAuthority(contract, 'unknown-provider-class');
  assert.equal(decision.authority, 'REJECTED');
  assert.match(decision.reasons[0], /unknown deployment target class/);
});
