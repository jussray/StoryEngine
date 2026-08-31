import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createCanonEvidence } from '../lib/canonEvidence.js';
import {
  getCanonAnchor, listCanonChanges, setCanonAnchor, unlockCanonAnchor
} from '../lib/canonMemory.js';
import {
  issueCanonAuthorityGrant, issueSession, resolveRequestIdentity
} from '../lib/securityContext.js';

const priorRegistry = process.env.L99_API_KEYS_JSON;
process.env.L99_API_KEYS_JSON = JSON.stringify([{
  key: 'canon-p2-human-key',
  actor_id: 'canon-p2-human',
  tenant_id: 'canon-p2-tenant',
  role: 'creator',
  principal_type: 'human',
  workspace_ids: ['*']
}]);

test.after(() => {
  if (priorRegistry === undefined) delete process.env.L99_API_KEYS_JSON;
  else process.env.L99_API_KEYS_JSON = priorRegistry;
});

function dbWithEvents() {
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

function grant(workspaceId) {
  const bootstrap = resolveRequestIdentity({ headers: { 'x-api-key': 'canon-p2-human-key' } });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  const req = {
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    request_id: `canon-p2-${workspaceId}`
  };
  return issueCanonAuthorityGrant(req, workspaceId);
}

function evidence(workspaceId, kind, key, value, ref) {
  return createCanonEvidence({
    workspace_id: workspaceId,
    kind,
    key,
    statement: value,
    source_ref: ref,
    authority: 'human'
  });
}

test('unlockCanonAnchor is evidence-backed, ledgered, and fail-closed', () => {
  const db = dbWithEvents();
  const workspaceId = 'ws-unlock';
  const kind = 'world_rule';
  const key = 'moon_gate';
  const value = 'The moon gate opens at midnight.';

  setCanonAnchor(db, {
    workspace_id: workspaceId,
    kind,
    key,
    value,
    locked: true,
    evidence: evidence(workspaceId, kind, key, value, 'test:create-locked'),
    authority_grant: grant(workspaceId)
  });

  const unlockEvidence = evidence(workspaceId, kind, key, value, 'test:unlock-review');
  const result = unlockCanonAnchor(db, {
    workspace_id: workspaceId,
    kind,
    key,
    evidence: unlockEvidence,
    authority_grant: grant(workspaceId)
  });

  assert.equal(result.locked, false);
  assert.equal(getCanonAnchor(db, workspaceId, kind, key).locked, 0);
  const [change] = listCanonChanges(db, workspaceId);
  assert.equal(change.operation, 'unlock');
  assert.equal(Boolean(change.previous_locked), true);
  assert.equal(Boolean(change.next_locked), false);
  assert.equal(change.evidence_id, unlockEvidence.evidence_id);
  assert.equal(change.approver_actor_id, 'canon-p2-human');
  db.close();
});

test('legacy anchors are baselined once and later ledger loss fails closed', () => {
  const db = dbWithEvents();
  db.exec(`CREATE TABLE canon_anchors (
    anchor_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'human',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.prepare(`INSERT INTO canon_anchors
    (anchor_id, workspace_id, kind, key, value, locked, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('legacy-1', 'ws-legacy', 'lore', 'origin', 'Before the ledger.', 1, 'human', 1000, 1000);

  const first = listCanonChanges(db, 'ws-legacy');
  assert.equal(first.length, 1);
  assert.equal(first[0].change_id, 'legacy_baseline:legacy-1');
  assert.equal(first[0].operation, 'legacy_baseline');
  assert.equal(first[0].source, 'legacy-baseline');
  assert.equal(first[0].evidence_id, null);
  assert.equal(first[0].approver_actor_id, null);
  assert.equal(Boolean(first[0].next_locked), true);

  const second = listCanonChanges(db, 'ws-legacy');
  assert.equal(second.length, 1);
  const migration = db.prepare(
    'SELECT COUNT(*) AS count FROM canon_schema_migrations WHERE migration_id=?'
  ).get('canon_change_ledger_legacy_baseline_v1');
  assert.equal(Number(migration.count), 1);

  db.prepare('DELETE FROM canon_change_ledger WHERE anchor_id=?').run('legacy-1');
  assert.throws(
    () => listCanonChanges(db, 'ws-legacy'),
    /Canon ledger integrity violation: anchor legacy-1 has no change history after canon_change_ledger_legacy_baseline_v1\./
  );
  const remaining = db.prepare(
    'SELECT COUNT(*) AS count FROM canon_change_ledger WHERE anchor_id=?'
  ).get('legacy-1');
  assert.equal(Number(remaining.count), 0);
  db.close();
});