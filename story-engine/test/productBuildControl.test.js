import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCT_BUILD_DIRECTIVE_CONTRACT,
  PRODUCT_BUILD_RECEIPT_CONTRACT,
  createProductBuildReceipt,
  productBuildDirectiveHash,
  productBuildReceiptHash,
  validateProductBuildDirective,
} from '../lib/productBuildControl.js';

const expectedHeadSha = 'b'.repeat(40);

function validDirective() {
  const value = {
    contract: PRODUCT_BUILD_DIRECTIVE_CONTRACT,
    directiveId: 'build-storyengine-001',
    proposal: {
      proposalId: 'chief-storyengine-build-001',
      proposalHash: 'a'.repeat(64),
      projectSlug: 'l99',
      actionType: 'build-product-control-room-loop',
      expectedHeadSha,
      capabilityPlanHash: 'c'.repeat(64),
    },
    founderDecisionHash: 'd'.repeat(64),
    productControlRoomId: 'storyengine-control-room',
    repository: 'jussray/StoryEngine',
    objective: 'Prove one bounded FCR to StoryEngine Control Room execution and receipt loop.',
    allowedCapabilities: ['founder-control-room-federation'],
    allowedMutationScope: ['control-room:event-log'],
    authorityCeiling: 'reversible_product_change',
    requiredProof: ['node-test', 'playwright'],
    stopConditions: ['any-authority-drift', 'one-successful-receipt'],
    rollback: 'Delete the single product-build audit event and revert the focused product-control-room adapter commit.',
    chiefCapabilityPlanRequired: true,
    executionAuthorized: true,
    receiptRequired: true,
    mergeAuthorized: false,
    deployAuthorized: false,
    providerMutationAuthorized: false,
  };
  return { ...value, directiveHash: productBuildDirectiveHash(value) };
}

test('StoryEngine accepts the exact bounded FCR product build directive', () => {
  const directive = validDirective();
  assert.deepEqual(validateProductBuildDirective(directive, { expectedHeadSha }), []);
  assert.match(directive.directiveHash, /^[0-9a-f]{64}$/);
});

test('StoryEngine rejects wrong repo, stale head, and widened mutation scope', () => {
  const directive = validDirective();

  assert.ok(validateProductBuildDirective({ ...directive, repository: 'jussray/Sekret-Bip' }, { expectedHeadSha })
    .includes('product build directive repository mismatch'));
  assert.ok(validateProductBuildDirective(directive, { expectedHeadSha: 'e'.repeat(40) })
    .includes('product build directive expectedHeadSha does not match this exact runtime head'));

  const widened = { ...directive, allowedMutationScope: ['control-room:event-log', 'repository:write'] };
  widened.directiveHash = productBuildDirectiveHash(widened);
  assert.ok(validateProductBuildDirective(widened, { expectedHeadSha })
    .includes('first product build actuator is limited to the Control Room event log'));
});

test('product receipt remains exact-directive-bound and non-authorizing for merge/deploy/provider mutation', () => {
  const directive = validDirective();
  const receipt = createProductBuildReceipt(directive, { id: 42 });
  assert.equal(receipt.contract, PRODUCT_BUILD_RECEIPT_CONTRACT);
  assert.equal(receipt.directiveHash, directive.directiveHash);
  assert.deepEqual(receipt.changedResources, ['control-room:event-log']);
  assert.deepEqual(receipt.proofRefs, ['storyengine:event-log:42']);
  assert.equal(receipt.mergePerformed, false);
  assert.equal(receipt.deployPerformed, false);
  assert.equal(receipt.providerMutationPerformed, false);
  assert.equal(receipt.receiptHash, productBuildReceiptHash({ ...receipt, receiptHash: undefined }));
});
