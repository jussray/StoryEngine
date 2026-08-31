import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import memoryRoutes from '../routes/memory.js';
import { getCanonAnchor, listCanonChanges } from '../lib/canonMemory.js';
import { analyzeStorySource, listSourceCanonState } from '../lib/sourceCanon.js';
import { issueSession, resolveRequestIdentity } from '../lib/securityContext.js';

const priorRegistry = process.env.L99_API_KEYS_JSON;
process.env.L99_API_KEYS_JSON = JSON.stringify([{
  key: 'canon-route-human-key',
  actor_id: 'canon-route-human',
  tenant_id: 'canon-route-tenant',
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

function liveHumanRequest(workspaceId, requestId = 'canon-authority-test') {
  const bootstrap = resolveRequestIdentity({ headers: { 'x-api-key': 'canon-route-human-key' } });
  const session = issueSession(bootstrap);
  const cookie = `l99_session=${encodeURIComponent(session.token)}`;
  return {
    request_id: requestId,
    headers: { cookie },
    auth: resolveRequestIdentity({ headers: { cookie } }),
    params: { workspace_id: workspaceId }
  };
}

function canonRequest(auth) {
  return {
    request_id: 'canon-authority-test',
    headers: {},
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

test('human creator session may promote canon with durable reviewer evidence', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/canon');

  const req = liveHumanRequest('workspace-authority');
  req.body = { kind: 'character', key: 'name', value: 'Maya', locked: true };
  const res = mockRes();
  handler(req, res);

  assert.equal(res.status, 201);
  assert.equal(res.body.source, 'human');
  assert.equal(getCanonAnchor(db, 'workspace-authority', 'character', 'name').value, 'Maya');

  const [change] = listCanonChanges(db, 'workspace-authority');
  assert.ok(change.evidence_id);
  assert.equal(change.evidence_authority, 'human');
  assert.equal(change.evidence_statement, 'Maya');
  assert.equal(change.evidence_source_ref, 'direct-entry:reviewer:canon-route-human');
  assert.equal(change.evidence_source_version, 'request:canon-authority-test');
  db.close();
});

test('direct canon update preserves an existing lock when locked is omitted', () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const handler = router.handlers.get('POST /api/memory/:workspace_id/canon');

  const first = liveHumanRequest('workspace-authority', 'create-locked');
  first.body = { kind: 'character', key: 'name', value: 'Maya', locked: true };
  const firstRes = mockRes();
  handler(first, firstRes);
  assert.equal(firstRes.status, 201);

  const second = liveHumanRequest('workspace-authority', 'update-preserve-lock');
  second.body = { kind: 'character', key: 'name', value: 'Maya Chen' };
  const secondRes = mockRes();
  handler(second, secondRes);
  assert.equal(secondRes.status, 201);
  assert.equal(getCanonAnchor(db, 'workspace-authority', 'character', 'name').locked, 1);
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
    headers: {},
    auth: { type: 'session', principal_type: 'agent', role: 'administrator' },
    params: { workspace_id: 'workspace-authority', proposal_id: 'proposal-forged' },
    body: { decision: 'approve' }
  }, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'human_authority_required');
  db.close();
});

test('human source approval persists exact source hash and reviewer provenance', async () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const workspaceId = 'workspace-source-authority';

  const analyzed = await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    title: 'Moon Key memory',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });
  const proposal = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  assert.ok(proposal);

  const handler = router.handlers.get('POST /api/memory/:workspace_id/proposals/:proposal_id/review');
  const req = liveHumanRequest(workspaceId, 'proposal-human-review');
  req.params.proposal_id = proposal.proposal_id;
  req.body = { decision: 'approve', key: 'protagonist.name', value: 'Nia Vale', locked: true };
  const res = mockRes();
  handler(req, res);

  assert.equal(res.status, 200);
  assert.equal(res.body.proposal.status, 'approved');
  const [change] = listCanonChanges(db, workspaceId);
  assert.ok(change.evidence_id);
  assert.equal(change.evidence_authority, 'human');
  assert.equal(change.evidence_statement, 'Nia Vale');
  assert.equal(
    change.evidence_source_ref,
    `source:${analyzed.source_id};proposal:${proposal.proposal_id};reviewer:canon-route-human`
  );
  assert.match(change.evidence_source_version, /^sha256:[a-f0-9]{64}$/);
  db.close();
});

test('proposal source hash resolves even when the source is older than the display window', async () => {
  const db = makeDb();
  const router = captureRouter();
  memoryRoutes(router, db);
  const workspaceId = 'workspace-old-source';
  const analyzed = await analyzeStorySource(db, {
    workspace_id: workspaceId,
    provider: 'local',
    title: 'Old source',
    content: 'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind.'
  });
  const proposal = listSourceCanonState(db, workspaceId).proposals.find(item => item.kind === 'character');
  assert.ok(proposal);

  const insert = db.prepare(`
    INSERT INTO story_sources (
      source_id, workspace_id, source_type, title, content, content_hash, status, extractor, created_at, analyzed_at
    ) VALUES (?, ?, 'text', ?, 'dummy', ?, 'review_ready', 'test', ?, ?)
  `);
  const base = Date.now() + 10_000;
  for (let index = 0; index < 55; index += 1) {
    insert.run(`newer-${index}`, workspaceId, `Newer ${index}`, `${index}`.padStart(64, '0'), base + index, base + index);
  }
  assert.equal(listSourceCanonState(db, workspaceId).sources.some(item => item.source_id === analyzed.source_id), false);

  const handler = router.handlers.get('POST /api/memory/:workspace_id/proposals/:proposal_id/review');
  const req = liveHumanRequest(workspaceId, 'old-source-review');
  req.params.proposal_id = proposal.proposal_id;
  req.body = { decision: 'approve', key: 'protagonist.name', value: 'Nia Vale' };
  const res = mockRes();
  handler(req, res);

  assert.equal(res.status, 200);
  const [change] = listCanonChanges(db, workspaceId);
  assert.match(change.evidence_source_version, /^sha256:[a-f0-9]{64}$/);
  db.close();
});
