import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import memoryRoutes from '../routes/memory.js';
import { getCanonAnchor, listCanonChanges } from '../lib/canonMemory.js';
import { issueSession, resolveRequestIdentity } from '../lib/securityContext.js';

const priorRegistry = process.env.L99_API_KEYS_JSON;
process.env.L99_API_KEYS_JSON = JSON.stringify([{
  key: 'canon-unlock-route-human-key',
  actor_id: 'canon-unlock-route-human',
  tenant_id: 'canon-unlock-route-tenant',
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
    headers: {},
    writableEnded: false,
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status) { this.status = status; },
    end(value = '') {
      this.writableEnded = true;
      this.body = value ? JSON.parse(value) : null;
    }
  };
}

function liveHumanRequest(workspaceId, requestId) {
  const bootstrap = resolveRequestIdentity({ headers: { 'x-api-key': 'canon-unlock-route-human-key' } });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  return {
    request_id: requestId,
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    params: { workspace_id: workspaceId }
  };
}

test('explicit creator unlock uses the evidence-backed unlock transition before editing canon', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/canon');
  const workspaceId = 'workspace-unlock-route';

  const createReq = liveHumanRequest(workspaceId, 'create-locked');
  createReq.body = { kind: 'character', key: 'name', value: 'Maya', locked: true };
  const createRes = mockRes();
  handler(createReq, createRes);
  assert.equal(createRes.status, 201);
  assert.equal(getCanonAnchor(db, workspaceId, 'character', 'name').locked, 1);

  const unlockReq = liveHumanRequest(workspaceId, 'unlock-and-edit');
  unlockReq.body = { kind: 'character', key: 'name', value: 'Maya Chen', locked: false };
  const unlockRes = mockRes();
  handler(unlockReq, unlockRes);

  assert.equal(unlockRes.status, 201);
  const anchor = getCanonAnchor(db, workspaceId, 'character', 'name');
  assert.equal(anchor.value, 'Maya Chen');
  assert.equal(anchor.locked, 0);

  const changes = listCanonChanges(db, workspaceId);
  const unlockChange = changes.find(change => change.operation === 'unlock');
  assert.ok(unlockChange);
  assert.equal(unlockChange.previous_locked, 1);
  assert.equal(unlockChange.next_locked, 0);
  assert.equal(unlockChange.evidence_statement, 'Maya');
  assert.equal(unlockChange.evidence_source_ref, 'direct-unlock:reviewer:canon-unlock-route-human');
  assert.equal(unlockChange.evidence_approver_actor_id, 'canon-unlock-route-human');

  const updateChange = changes.find(change => change.operation === 'update' && change.next_value === 'Maya Chen');
  assert.ok(updateChange);
  assert.equal(updateChange.evidence_source_ref, 'direct-entry:reviewer:canon-unlock-route-human');
  db.close();
});
