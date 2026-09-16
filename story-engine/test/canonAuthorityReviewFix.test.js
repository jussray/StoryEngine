import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createCanonEvidence } from '../lib/canonEvidence.js';
import { getCanonAnchor, listCanonChanges, setCanonAnchor } from '../lib/canonMemory.js';
import memoryRoutes from '../routes/memory.js';
import { issueCanonAuthorityGrant, issueSession, resolveRequestIdentity } from '../lib/securityContext.js';

const priorRegistry = process.env.L99_API_KEYS_JSON;
const humanRegistry = [{
  key: 'review-fix-human-key',
  actor_id: 'review-fix-human',
  tenant_id: 'review-fix-tenant',
  role: 'creator',
  principal_type: 'human',
  workspace_ids: ['*']
}];
process.env.L99_API_KEYS_JSON = JSON.stringify(humanRegistry);

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

function liveRequest(workspaceId, requestId = 'review-fix') {
  process.env.L99_API_KEYS_JSON = JSON.stringify(humanRegistry);
  const bootstrap = resolveRequestIdentity({ headers: { 'x-api-key': 'review-fix-human-key' } });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  return {
    request_id: requestId,
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    params: { workspace_id: workspaceId },
    session
  };
}

function grantFor(workspaceId) {
  const req = liveRequest(workspaceId, `grant-${workspaceId}`);
  return { grant: issueCanonAuthorityGrant(req, workspaceId), req };
}

function evidenceFor({ workspace_id, kind, key, value, source_ref = 'test:review-fix' }) {
  return createCanonEvidence({
    workspace_id,
    kind,
    key,
    statement: String(value),
    source_ref,
    authority: 'human'
  });
}

function captureRouter() {
  const handlers = new Map();
  const register = method => (path, handler) => handlers.set(`${method} ${path}`, handler);
  return {
    handlers,
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    delete: register('DELETE')
  };
}

function mockRes() {
  return {
    status: null,
    body: null,
    writableEnded: false,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status) { this.status = status; },
    end(value = '') {
      this.writableEnded = true;
      this.body = value ? JSON.parse(value) : null;
    }
  };
}

test('pre-issued canon grant fails after scoped credential removal', () => {
  const db = makeDb();
  const input = { workspace_id: 'ws-revoked', kind: 'character', key: 'name', value: 'Maya' };
  const evidence = evidenceFor(input);
  const { grant } = grantFor(input.workspace_id);

  process.env.L99_API_KEYS_JSON = '[]';
  assert.throws(() => setCanonAnchor(db, {
    ...input,
    evidence,
    authority_grant: grant
  }), /no longer backed by a live authenticated human session/);
  assert.equal(getCanonAnchor(db, input.workspace_id, input.kind, input.key), null);

  process.env.L99_API_KEYS_JSON = JSON.stringify(humanRegistry);
  db.close();
});

test('idempotent replay fails closed when ledger source provenance is tampered', () => {
  const db = makeDb();
  const input = { workspace_id: 'ws-replay-source', kind: 'character', key: 'name', value: 'Maya' };
  const evidence = evidenceFor(input);
  setCanonAnchor(db, {
    ...input,
    evidence,
    authority_grant: grantFor(input.workspace_id).grant
  });
  db.prepare('UPDATE canon_change_ledger SET source=? WHERE evidence_id=?').run('tampered', evidence.evidence_id);

  assert.throws(() => setCanonAnchor(db, {
    ...input,
    evidence,
    authority_grant: grantFor(input.workspace_id).grant
  }), /ledger binding failed integrity verification/);
  assert.equal(getCanonAnchor(db, input.workspace_id, input.kind, input.key).value, 'Maya');
  db.close();
});

test('creator route edits an unlocked anchor and locks it through a dedicated lock transition', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/canon');
  const workspaceId = 'ws-route-lock';

  const createReq = liveRequest(workspaceId, 'route-create');
  createReq.body = { kind: 'character', key: 'name', value: 'Maya', locked: false };
  const createRes = mockRes();
  handler(createReq, createRes);
  assert.equal(createRes.status, 201);
  assert.equal(getCanonAnchor(db, workspaceId, 'character', 'name').locked, 0);

  const updateReq = liveRequest(workspaceId, 'route-edit-lock');
  updateReq.body = { kind: 'character', key: 'name', value: 'Maya Chen', locked: true };
  const updateRes = mockRes();
  handler(updateReq, updateRes);

  assert.equal(updateRes.status, 201);
  const anchor = getCanonAnchor(db, workspaceId, 'character', 'name');
  assert.equal(anchor.value, 'Maya Chen');
  assert.equal(anchor.locked, 1);
  const changes = listCanonChanges(db, workspaceId);
  assert.equal(changes[0].operation, 'lock');
  assert.equal(changes[0].previous_locked, 0);
  assert.equal(changes[0].next_locked, 1);
  assert.equal(changes[1].operation, 'update');
  assert.equal(changes[1].next_value, 'Maya Chen');
  assert.equal(changes[0].approver_actor_id, 'review-fix-human');
  assert.equal(changes[1].approver_actor_id, 'review-fix-human');
  db.close();
});
