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

function withEnv(changes, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(changes)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('StoryEngine accepts only the exact bounded FCR product build directive', () => {
  const directive = validDirective();
  assert.deepEqual(validateProductBuildDirective(directive, { expectedHeadSha }), []);

  assert.ok(validateProductBuildDirective({ ...directive, repository: 'jussray/Sekret-Bip' }, { expectedHeadSha })
    .includes('product build directive repository mismatch'));
  assert.ok(validateProductBuildDirective(directive, { expectedHeadSha: 'e'.repeat(40) })
    .includes('product build directive expectedHeadSha does not match this exact runtime head'));

  const widened = { ...directive, allowedMutationScope: ['control-room:event-log', 'repository:write'] };
  widened.directiveHash = productBuildDirectiveHash(widened);
  assert.ok(validateProductBuildDirective(widened, { expectedHeadSha })
    .includes('first product build actuator is limited to the Control Room event log'));
});

test('production binds product-build directives to Railway native exact release identity', () => {
  withEnv({
    NODE_ENV: 'production',
    EXPECTED_HEAD_SHA: undefined,
    RAILWAY_GIT_COMMIT_SHA: expectedHeadSha,
    L99_RELEASE_SHA: undefined,
  }, () => {
    assert.deepEqual(validateProductBuildDirective(validDirective()), []);

    const stale = validDirective();
    stale.proposal = { ...stale.proposal, expectedHeadSha: 'e'.repeat(40) };
    stale.directiveHash = productBuildDirectiveHash(stale);
    assert.ok(validateProductBuildDirective(stale)
      .includes('product build directive expectedHeadSha does not match this exact runtime head'));
  });
});

test('production product-build execution fails closed without trusted runtime exact-head identity', () => {
  withEnv({
    NODE_ENV: 'production',
    EXPECTED_HEAD_SHA: undefined,
    RAILWAY_GIT_COMMIT_SHA: undefined,
    L99_RELEASE_SHA: undefined,
  }, () => {
    assert.ok(validateProductBuildDirective(validDirective())
      .includes('product build execution requires trusted runtime exact-head identity'));
  });
});

test('product receipt remains directive-bound and cannot authorize merge/deploy/provider mutation', () => {
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

test('replaying the same directive is idempotent', () => {
  const db = createEventDb();
  try {
    const directive = validDirective();
    const first = executeProductBuildDirective(db, directive, { expectedHeadSha });
    const replay = executeProductBuildDirective(db, directive, { expectedHeadSha });
    assert.deepEqual(replay, first);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type='control_room.product_build_directive_executed'").get().count), 1);
  } finally {
    db.close();
  }
});

test('product build fails closed inside an outer transaction', () => {
  const db = createEventDb();
  try {
    db.exec('BEGIN');
    assert.throws(() => executeProductBuildDirective(db, validDirective(), { expectedHeadSha }), /top-level immediate transaction/);
    db.exec('ROLLBACK');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM events').get().count), 0);
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
});
