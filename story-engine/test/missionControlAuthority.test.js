import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import missionControlRoutes from '../routes/missionControl.js';
import { ensureRuntimeDispatchSchema } from '../lib/runtimeDispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  ensureRuntimeDispatchSchema(db);
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, tenant_id, created_by_actor_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('workspace-a', 'A', 'tenant-a', 'actor-a', now, now);
  db.prepare(`
    INSERT INTO stories (workspace_id, title, tenant_id, created_by_actor_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('workspace-b', 'B', 'tenant-b', 'actor-b', now, now);
  db.prepare(`
    INSERT INTO workspace_memberships (workspace_id, tenant_id, actor_id, role, created_at)
    VALUES (?, ?, ?, 'creator', ?)
  `).run('workspace-a', 'tenant-a', 'actor-a', now);
  db.prepare(`
    INSERT INTO workspace_memberships (workspace_id, tenant_id, actor_id, role, created_at)
    VALUES (?, ?, ?, 'viewer', ?)
  `).run('workspace-a', 'tenant-a', 'actor-viewer', now);
  db.prepare(`
    INSERT INTO workspace_memberships (workspace_id, tenant_id, actor_id, role, created_at)
    VALUES (?, ?, ?, 'creator', ?)
  `).run('workspace-b', 'tenant-b', 'actor-b', now);
  return db;
}

function captureRoutes(db) {
  const routes = new Map();
  const router = {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); }
  };
  missionControlRoutes(router, db);
  return routes;
}

function responseRecorder() {
  return {
    statusCode: null,
    body: '',
    writableEnded: false,
    setHeader() {},
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(chunk = '') { this.body += String(chunk); this.writableEnded = true; }
  };
}

const creator = {
  type: 'session',
  actor_id: 'actor-a',
  tenant_id: 'tenant-a',
  role: 'creator',
  workspace_ids: ['workspace-a']
};

const viewer = {
  type: 'session',
  actor_id: 'actor-viewer',
  tenant_id: 'tenant-a',
  role: 'viewer',
  workspace_ids: ['workspace-a']
};

function insertDispatch(db, { dispatchId, workspaceId, status = 'completed' }) {
  db.prepare(`
    INSERT INTO runtime_dispatch_queue (
      dispatch_id, workspace_id, trigger_type, fingerprint, status, attempts,
      run_id, created_at, completed_at
    ) VALUES (?, ?, 'test', ?, ?, 1, ?, ?, ?)
  `).run(
    dispatchId,
    workspaceId,
    `fp-${dispatchId}`,
    status,
    status === 'completed' ? `run-${dispatchId}` : null,
    Date.now(),
    status === 'completed' ? Date.now() : null
  );
}

test('creator cannot use global mission-control or queue mutation surfaces', async () => {
  const db = createDb();
  const routes = captureRoutes(db);
  const targets = [
    ['GET /api/mission-control/snapshot', { query: {} }],
    ['GET /api/runtime/dispatch-queue', { query: {} }],
    ['POST /api/runtime/drain', { body: { limit: 5 } }],
    ['POST /api/runtime/scan', { body: {} }],
    ['POST /api/mission-control/retention/run', { body: { dry_run: true } }]
  ];

  for (const [key, extras] of targets) {
    const req = { auth: creator, request_id: `deny-${key}`, db, ...extras };
    const res = responseRecorder();
    await routes.get(key)(req, res);
    assert.equal(res.statusCode, 403, key);
    assert.equal(JSON.parse(res.body).error, 'forbidden', key);
  }
  db.close();
});

test('creator may process only a dispatch belonging to an authorized workspace', async () => {
  const db = createDb();
  const routes = captureRoutes(db);
  insertDispatch(db, { dispatchId: 'dispatch-own', workspaceId: 'workspace-a' });
  insertDispatch(db, { dispatchId: 'dispatch-other', workspaceId: 'workspace-b' });

  const ownReq = {
    auth: creator,
    request_id: 'own-dispatch',
    db,
    params: { dispatch_id: 'dispatch-own' },
    body: {}
  };
  const ownRes = responseRecorder();
  await routes.get('POST /api/runtime/dispatch/:dispatch_id/process')(ownReq, ownRes);
  assert.equal(ownRes.statusCode, 200);
  assert.deepEqual(JSON.parse(ownRes.body), {
    dispatch_id: 'dispatch-own',
    status: 'completed',
    run_id: 'run-dispatch-own',
    error: null,
    skipped: true
  });

  const otherReq = {
    auth: creator,
    request_id: 'other-dispatch',
    db,
    params: { dispatch_id: 'dispatch-other' },
    body: {}
  };
  const otherRes = responseRecorder();
  await routes.get('POST /api/runtime/dispatch/:dispatch_id/process')(otherReq, otherRes);
  assert.equal(otherRes.statusCode, 403);
  assert.equal(JSON.parse(otherRes.body).error, 'workspace_forbidden');
  db.close();
});

test('viewer membership stays read-only for runtime enqueue and processing', async () => {
  const db = createDb();
  const routes = captureRoutes(db);
  insertDispatch(db, { dispatchId: 'dispatch-viewer', workspaceId: 'workspace-a' });

  const enqueueReq = {
    auth: viewer,
    request_id: 'viewer-enqueue',
    db,
    params: { workspace_id: 'workspace-a' },
    body: { trigger_type: 'manual_dispatch' }
  };
  const enqueueRes = responseRecorder();
  await routes.get('POST /api/runtime/dispatch/:workspace_id')(enqueueReq, enqueueRes);
  assert.equal(enqueueRes.statusCode, 403);
  assert.equal(JSON.parse(enqueueRes.body).error, 'forbidden');

  const processReq = {
    auth: viewer,
    request_id: 'viewer-process',
    db,
    params: { dispatch_id: 'dispatch-viewer' },
    body: {}
  };
  const processRes = responseRecorder();
  await routes.get('POST /api/runtime/dispatch/:dispatch_id/process')(processReq, processRes);
  assert.equal(processRes.statusCode, 403);
  assert.equal(JSON.parse(processRes.body).error, 'forbidden');
  db.close();
});

test('creator cannot enqueue runtime work for another tenant workspace', async () => {
  const db = createDb();
  const routes = captureRoutes(db);
  const req = {
    auth: creator,
    request_id: 'enqueue-other',
    db,
    params: { workspace_id: 'workspace-b' },
    body: { trigger_type: 'manual_dispatch' }
  };
  const res = responseRecorder();
  await routes.get('POST /api/runtime/dispatch/:workspace_id')(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'workspace_forbidden');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue WHERE workspace_id=?').get('workspace-b').count,
    0
  );
  db.close();
});

test('creator can enqueue runtime work for an authorized workspace', async () => {
  const db = createDb();
  const routes = captureRoutes(db);
  const req = {
    auth: creator,
    request_id: 'enqueue-own',
    db,
    params: { workspace_id: 'workspace-a' },
    body: { trigger_type: 'manual_dispatch' }
  };
  const res = responseRecorder();
  await routes.get('POST /api/runtime/dispatch/:workspace_id')(req, res);
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.workspace_id, 'workspace-a');
  assert.equal(body.status, 'queued');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue WHERE workspace_id=?').get('workspace-a').count,
    1
  );
  db.close();
});

test('administrator retains the global queue drain control', async () => {
  const db = createDb();
  const routes = captureRoutes(db);
  const req = {
    auth: {
      type: 'session', actor_id: 'founder', tenant_id: 'founder',
      role: 'administrator', workspace_ids: ['*']
    },
    request_id: 'admin-drain',
    db,
    body: { limit: 1 }
  };
  const res = responseRecorder();
  await routes.get('POST /api/runtime/drain')(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { processed: [] });
  db.close();
});
