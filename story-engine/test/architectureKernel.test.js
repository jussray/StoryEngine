import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const REQUIRED_CORE = [
  'intent', 'north-star', 'truth', 'authority', 'state', 'continuity',
  'capability-routing', 'verification', 'proof', 'rollback', 'task-accuracy', 'outcome-learning',
];

test('project architecture stays primary and external systems remain removable plugins', () => {
  const kernelUrl = new URL('../../.control-room/architecture-kernel.json', import.meta.url);
  const kernel = JSON.parse(readFileSync(kernelUrl, 'utf8'));

  assert.equal(kernel.contract, 'juss/self-sufficient-architecture@v1');
  assert.equal(kernel.project, 'storyengine-l99');
  assert.equal(kernel.coreOwner, 'project');
  assert.equal(new Set(kernel.coreCapabilities).size, kernel.coreCapabilities.length);
  for (const capability of REQUIRED_CORE) assert.ok(kernel.coreCapabilities.includes(capability), `missing ${capability}`);
  assert.deepEqual(kernel.externalSystems, {
    role: 'plugin',
    requiredForCoreBoot: false,
    mayOwnCoreCapability: false,
    mayIncreaseAuthority: false,
    silentSubstitutionAllowed: false,
    identityMustBeReceipted: true,
    failurePolicy: 'scoped-blocker',
    selectionPolicy: 'capability-fit',
    purpose: 'extend-or-accelerate',
  });
});
