import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createCanonEvidence } from '../lib/canonEvidence.js';
import { setCanonAnchor, getCanonAnchor } from '../lib/canonMemory.js';
import { issueCanonAuthorityGrant, issueSession, resolveRequestIdentity } from '../lib/securityContext.js';

const priorRegistry = process.env.L99_API_KEYS_JSON;
process.env.L99_API_KEYS_JSON = JSON.stringify([{
  key: 'replay-integrity-human-key',
  actor_id: 'replay-integrity-human',
  tenant_id: 'replay-integrity-tenant',
  role: 'creator',
  principal_type: 'human',
  workspace_ids: ['*']
}]);

test.after(() => {
  if (priorRegistry === undefined) delete process.env.L99_API_KEYS_JSON;
  else process.env.L99_API_KEYS_JSON = priorRegistry;
});

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    mode TEXT,
    event_type TEXT NOT NULL,
    payload TEXT,
    duration_ms INTEGER,
    rollback INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER
  )`);
  return db;
}

function humanGrant(workspace_id) {
  const bootstrap = resolveRequestIdentity({ headers: { 'x-api-key': 'replay-integrity-human-key' } });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  const req = {
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    request_id: `replay-integrity-${workspace_id}`
  };
  return issueCanonAuthorityGrant(req, workspace_id);
}

function evidenceFor(input) {
  return createCanonEvidence({
    workspace_id: input.workspace_id,
    kind: input.kind,
    key: input.key,
    statement: String(input.value),
    source_ref: 'test:replay-integrity',
    authority: 'human'
  });
}

function seed(db) {
  const input = { workspace_id: 'ws-replay', kind: 'character', key: 'name', value: 'Maya' };
  const evidence = evidenceFor(input);
  setCanonAnchor(db, { ...input, evidence, authority_grant: humanGrant(input.workspace_id) });
  return { input, evidence };
}

function replay(db, input, evidence) {
  return setCanonAnchor(db, {
    ...input,
    evidence,
    authority_grant: humanGrant(input.workspace_id)
  });
}

test('idempotent replay requires the persisted evidence row', () => {
  const db = makeDb();
  const { input, evidence } = seed(db);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.prepare('DELETE FROM canon_evidence WHERE evidence_id=?').run(evidence.evidence_id);

  assert.throws(() => replay(db, input, evidence), /persisted evidence record is missing/);
  assert.strictEqual(getCanonAnchor(db, input.workspace_id, input.kind, input.key).value, input.value);
});

test('idempotent replay verifies the stored transition fingerprint', () => {
  const db = makeDb();
  const { input, evidence } = seed(db);
  db.prepare('UPDATE canon_evidence_usage SET operation=? WHERE evidence_id=?').run('tampered', evidence.evidence_id);

  assert.throws(() => replay(db, input, evidence), /transition binding failed integrity verification/);
  assert.strictEqual(getCanonAnchor(db, input.workspace_id, input.kind, input.key).value, input.value);
});

test('idempotent replay verifies the evidence-bound ledger row', () => {
  const db = makeDb();
  const { input, evidence } = seed(db);
  const usage = db.prepare('SELECT ledger_sequence FROM canon_evidence_usage WHERE evidence_id=?').get(evidence.evidence_id);
  db.prepare('UPDATE canon_change_ledger SET evidence_fingerprint=? WHERE sequence=?').run('tampered', usage.ledger_sequence);

  assert.throws(() => replay(db, input, evidence), /ledger binding failed integrity verification/);
  assert.strictEqual(getCanonAnchor(db, input.workspace_id, input.kind, input.key).value, input.value);
});
