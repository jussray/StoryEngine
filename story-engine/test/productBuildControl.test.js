import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  PRODUCT_BUILD_DIRECTIVE_CONTRACT,
  PRODUCT_BUILD_RECEIPT_CONTRACT,
  createProductBuildReceipt,
  executeProductBuildDirective,
  productBuildDirectiveHash,
  productBuildReceiptHash,
  validateProductBuildDirective,
} from '../lib/productBuildControl.js';

const expectedHeadSha = 'b'.repeat(40);
const CROSS_REPO_FOUNDER_DECISION_HASH = '45a2b662e3d015dcf8482304198b1df804766ed583627992b9d1be2ee76d394d';
const CROSS_REPO_DIRECTIVE_HASH = '125d224d7aa29b657f0732d0bc209df9d94848708764a5a8e5d74d4e85100247';

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
    founderDecisionHash: CROSS_REPO_FOUNDER_DECISION_HASH,
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

function createEventDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      mode TEXT,
      event_type TEXT NOT NULL,
      payload TEXT,
      duration_ms INTEGER,
      rollback INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

test('StoryEngine accepts the exact bounded FCR product build directive', () => {
  const directive = validDirective();
  assert.deepEqual(validateProductBuildDirective(directive, { expectedHeadSha }), []);
  assert.equal(directive.founderDecisionHash, CROSS_REPO_FOUNDER_DECISION_HASH);
  assert.equal(directive.directiveHash, CROSS_REPO_DIRECTIVE_HASH);
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

test('replaying the same directive returns the original receipt without a second mutation', () => {
  const db = createEventDb();
  try {
    const directive = validDirective();
    const first = executeProductBuildDirective(db, directive, { expectedHeadSha });
    const replay = executeProductBuildDirective(db, directive, { expectedHeadSha });

    assert.deepEqual(replay, first);
    assert.equal(replay.executionReceiptId, first.executionReceiptId);
    assert.equal(replay.receiptHash, first.receiptHash);

    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM events
      WHERE event_type = 'control_room.product_build_directive_executed'
    `).get();
    assert.equal(Number(row.count), 1);
  } finally {
    db.close();
  }
});

test('product-build execution fails closed when an outer deferred transaction could weaken the mutation lock', () => {
  const db = createEventDb();
  try {
    db.exec('BEGIN');
    assert.throws(
      () => executeProductBuildDirective(db, validDirective(), { expectedHeadSha }),
      /top-level immediate transaction/,
    );
    db.exec('ROLLBACK');

    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM events
      WHERE event_type = 'control_room.product_build_directive_executed'
    `).get();
    assert.equal(Number(row.count), 0);
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
});
