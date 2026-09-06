import { test, expect } from '@playwright/test';
import {
  PRODUCT_BUILD_DIRECTIVE_CONTRACT,
  productBuildDirectiveHash,
} from '../lib/productBuildControl.js';

function buildDirective(suffix = '001') {
  const expectedHeadSha = String(process.env.EXPECTED_HEAD_SHA || 'b'.repeat(40)).toLowerCase();
  const value = {
    contract: PRODUCT_BUILD_DIRECTIVE_CONTRACT,
    directiveId: `build-storyengine-playwright-${suffix}`,
    proposal: {
      proposalId: `chief-storyengine-playwright-${suffix}`,
      proposalHash: 'a'.repeat(64),
      projectSlug: 'l99',
      actionType: 'build-product-control-room-loop',
      expectedHeadSha,
      capabilityPlanHash: 'c'.repeat(64),
    },
    founderDecisionHash: 'd'.repeat(64),
    productControlRoomId: 'storyengine-control-room',
    repository: 'jussray/StoryEngine',
    objective: 'Prove the first bounded FCR to StoryEngine Control Room actuator.',
    allowedCapabilities: ['founder-control-room-federation'],
    allowedMutationScope: ['control-room:event-log'],
    authorityCeiling: 'reversible_product_change',
    requiredProof: ['node-test', 'playwright'],
    stopConditions: ['any-authority-drift', 'one-successful-receipt'],
    rollback: 'Delete the single product-build audit event and revert the focused adapter commit.',
    chiefCapabilityPlanRequired: true,
    executionAuthorized: true,
    receiptRequired: true,
    mergeAuthorized: false,
    deployAuthorized: false,
    providerMutationAuthorized: false,
  };
  return { ...value, directiveHash: productBuildDirectiveHash(value) };
}

async function expectFcrControllerDenied(request, key, suffix) {
  const response = await request.post('/api/control-room/product-build/execute', {
    headers: { 'x-api-key': key },
    data: buildDirective(suffix),
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ error: 'founder_control_room_controller_required' });
}

test('lower-privilege scoped caller cannot drive the product Control Room actuator', async ({ request }) => {
  await expectFcrControllerDenied(request, 'playwright-scoped-key', 'creator');
});

test('administrator from a non-FCR tenant cannot impersonate the product Control Room', async ({ request }) => {
  await expectFcrControllerDenied(request, 'playwright-other-admin-key', 'other-tenant-admin');
});

test('different administrator inside the FCR tenant cannot impersonate the dedicated actuator principal', async ({ request }) => {
  await expectFcrControllerDenied(request, 'playwright-other-fcr-admin-key', 'other-fcr-admin');
});

test('dedicated FCR service principal executes one bounded StoryEngine Control Room actuator and gets a receipt', async ({ request }) => {
  const directive = buildDirective();
  const response = await request.post('/api/control-room/product-build/execute', {
    headers: { 'x-api-key': 'playwright-admin-key' },
    data: directive,
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.receipt).toMatchObject({
    contract: 'juss-v10/product-build-receipt@v1',
    directiveHash: directive.directiveHash,
    productControlRoomId: 'storyengine-control-room',
    repository: 'jussray/StoryEngine',
    status: 'completed',
    changedResources: ['control-room:event-log'],
    mergePerformed: false,
    deployPerformed: false,
    providerMutationPerformed: false,
  });
  expect(body.receipt.executionReceiptId).toMatch(/^storyengine-event-\d+$/);
  expect(body.receipt.proofRefs[0]).toMatch(/^storyengine:event-log:\d+$/);
  expect(body.receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
  expect(body.authority).toMatchObject({
    caller_tenant: 'founder-control-room',
    caller_actor: 'fcr-storyengine-control-room',
    execution_authorized_by_directive: true,
    merge_authorized: false,
    deploy_authorized: false,
    provider_mutation_authorized: false,
    external_proof_still_required: true,
  });
});

test('replaying the exact directive returns the original receipt instead of mutating twice', async ({ request }) => {
  const directive = buildDirective('replay-001');
  const post = () => request.post('/api/control-room/product-build/execute', {
    headers: { 'x-api-key': 'playwright-admin-key' },
    data: directive,
  });

  const firstResponse = await post();
  const replayResponse = await post();
  expect(firstResponse.status()).toBe(200);
  expect(replayResponse.status()).toBe(200);

  const first = await firstResponse.json();
  const replay = await replayResponse.json();
  expect(replay.receipt).toEqual(first.receipt);
  expect(replay.receipt.executionReceiptId).toBe(first.receipt.executionReceiptId);
  expect(replay.receipt.receiptHash).toBe(first.receipt.receiptHash);
  expect(replay.authority).toMatchObject({
    caller_tenant: 'founder-control-room',
    caller_actor: 'fcr-storyengine-control-room',
    merge_authorized: false,
    deploy_authorized: false,
    provider_mutation_authorized: false,
    external_proof_still_required: true,
  });
});

test('exact-head drift fails closed even for the dedicated FCR service principal', async ({ request }) => {
  const directive = buildDirective();
  const stale = {
    ...directive,
    proposal: { ...directive.proposal, expectedHeadSha: 'e'.repeat(40) },
  };
  stale.directiveHash = productBuildDirectiveHash(stale);

  const response = await request.post('/api/control-room/product-build/execute', {
    headers: { 'x-api-key': 'playwright-admin-key' },
    data: stale,
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error).toBe('invalid_product_build_directive');
  expect(body.message).toContain('expectedHeadSha does not match this exact runtime head');
});
