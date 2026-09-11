import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createCanonEvidence } from '../lib/canonEvidence.js';
import { getCanonAnchor, setCanonAnchor } from '../lib/canonMemory.js';
import {
  issueCanonAuthorityGrant, issueSession, resolveRequestIdentity
} from '../lib/securityContext.js';

const priorRegistry = process.env.L99_API_KEYS_JSON;
process.env.L99_API_KEYS_JSON = JSON.stringify([{
  key: 'canon-replay-scope-human-key',
  actor_id: 'canon-replay-scope-human',
  tenant_id: 'canon-replay-scope-tenant',
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
  const bootstrap = resolveRequestIdentity({
    headers: { 'x-api-key': 'canon-replay-scope-human-key' }
  });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  const req = {
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    request_id: `canon-replay-scope-${workspaceId}`
  };
  return issueCanonAuthorityGrant(req, workspaceId);
}

function evidence(workspaceId, kind, key, value) {
  return createCanonEvidence({
    workspace_id: workspaceId,
    kind,
    key,
    statement: value,
    source_ref: 'test:live-anchor-scope',
    authority: 'human'
  });
}

test('idempotent evidence replay rejects a live anchor whose persisted scope was corrupted', () => {
  const db = dbWithEvents();
  const workspaceId = 'ws-replay-scope';
  const kind = 'world_rule';
  const key = 'scope_guard';
  const value = 'The scope guard remains bound to its original workspace.';
  const receipt = evidence(workspaceId, kind, key, value);

  const created = setCanonAnchor(db, {
    workspace_id: workspaceId,
    kind,
    key,
    value,
    locked: false,
    evidence: receipt,
    authority_grant: grant(workspaceId)
  });

  db.prepare('UPDATE canon_anchors SET workspace_id=? WHERE anchor_id=?')
    .run('ws-corrupted-scope', created.anchor_id);

  assert.throws(
    () => setCanonAnchor(db, {
      workspace_id: workspaceId,
      kind,
      key,
      value,
      locked: false,
      evidence: receipt,
      authority_grant: grant(workspaceId)
    }),
    /Canon evidence replay rejected: evidence is already bound to a different or superseded mutation\./
  );

  assert.equal(getCanonAnchor(db, workspaceId, kind, key), null);
  const corrupted = db.prepare(
    'SELECT workspace_id, kind, key FROM canon_anchors WHERE anchor_id=?'
  ).get(created.anchor_id);
  assert.equal(corrupted.workspace_id, 'ws-corrupted-scope');
  assert.equal(corrupted.kind, kind);
  assert.equal(corrupted.key, key);

  db.close();
});
