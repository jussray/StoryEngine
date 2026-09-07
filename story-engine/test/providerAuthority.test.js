import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateProductionOriginAuthority,
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

test('production origin is authorized only when source and environment agree', () => {
  const decision = evaluateProductionOriginAuthority(
    { productionOrigin: 'https://story.example.test/' },
    'https://story.example.test'
  );
  assert.equal(decision.authority, 'AUTHORIZED');
  assert.equal(decision.production_origin, 'https://story.example.test');
  assert.equal(decision.authorized_origin, 'https://story.example.test');
  assert.deepEqual(decision.reasons, []);
});

test('missing source-controlled production origin fails closed', () => {
  const decision = evaluateProductionOriginAuthority(
    { productionOrigin: null },
    'https://story.example.test'
  );
  assert.equal(decision.authority, 'REJECTED');
  assert.ok(decision.reasons.some(reason => reason.includes('productionOrigin is not bound')));
});

test('production environment origin mismatch fails closed', () => {
  const decision = evaluateProductionOriginAuthority(
    { productionOrigin: 'https://story.example.test' },
    'https://attacker.example.test'
  );
  assert.equal(decision.authority, 'REJECTED');
  assert.ok(decision.reasons.some(reason => reason.includes('production origin mismatch')));
});

test('non-HTTPS or path-scoped production origins fail closed', () => {
  const insecure = evaluateProductionOriginAuthority(
    { productionOrigin: 'http://story.example.test' },
    'https://story.example.test'
  );
  assert.equal(insecure.authority, 'REJECTED');

  const pathScoped = evaluateProductionOriginAuthority(
    { productionOrigin: 'https://story.example.test/app' },
    'https://story.example.test'
  );
  assert.equal(pathScoped.authority, 'REJECTED');
});
