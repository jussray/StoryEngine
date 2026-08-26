import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import memoryRoutes from '../routes/memory.js';
import { getCanonAnchor } from '../lib/canonMemory.js';

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

function canonRequest(auth) {
  return {
    request_id: 'canon-authority-test',
    auth,
    params: { workspace_id: 'workspace-authority' },
    body: { kind: 'character', key: 'name', value: 'Maya', locked: true }
  };
}

test('canon promotion rejects machine, raw-key, and viewer identities before mutation', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/canon');
  assert.ok(handler);

  for (const [label, auth, expectedError] of [
    ['service session', { type: 'session', principal_type: 'service', role: 'administrator' }, 'human_authority_required'],
    ['raw human key', { type: 'scoped_api_key', principal_type: 'human', role: 'administrator' }, 'human_authority_required'],
    ['human viewer', { type: 'session', principal_type: 'human', role: 'viewer' }, 'canon_role_forbidden']
  ]) {
    const res = mockRes();
    handler(canonRequest(auth), res);
    assert.equal(res.status, 403, label);
    assert.equal(res.body.error, expectedError, label);
    assert.equal(getCanonAnchor(db, 'workspace-authority', 'character', 'name'), null, label);
  }

  db.close();
});

test('human creator session may promote canon after global auth/workspace gates have admitted it', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/canon');

  const res = mockRes();
  handler(canonRequest({ type: 'session', principal_type: 'human', role: 'creator' }), res);

  assert.equal(res.status, 201);
  assert.equal(res.body.source, 'human');
  assert.equal(getCanonAnchor(db, 'workspace-authority', 'character', 'name').value, 'Maya');
  db.close();
});

test('source proposal review also rejects non-human authority before touching proposal state', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/proposals/:proposal_id/review');
  assert.ok(handler);

  const res = mockRes();
  handler({
    request_id: 'proposal-authority-test',
    auth: { type: 'session', principal_type: 'agent', role: 'administrator' },
    params: { workspace_id: 'workspace-authority', proposal_id: 'proposal-forged' },
    body: { decision: 'approve' }
  }, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'human_authority_required');
  db.close();
});
