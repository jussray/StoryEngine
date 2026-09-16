import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import storyEngineRoutes from '../routes/storyEngine.js';
import { startHumanLedStoryEngineRun } from '../lib/storyEngineAssistAuthority.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
const TEST_IDENTITY = Object.freeze({ tenant_id: 'tenant-test', actor_id: 'actor-test', role: 'creator' });

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function captureRoutes(db) {
  const handlers = new Map();
  const router = {
    get(path, handler) { handlers.set(`GET ${path}`, handler); },
    post(path, handler) { handlers.set(`POST ${path}`, handler); }
  };
  storyEngineRoutes(router, db);
  return handlers;
}

function responseRecorder() {
  return {
    writableEnded: false,
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = JSON.parse(body);
      this.writableEnded = true;
    }
  };
}

async function writerRun(db, identity = TEST_IDENTITY) {
  return startHumanLedStoryEngineRun(db, {
    story_vision: 'Write a mystery podcast for teens.',
    medium: 'podcast',
    audience: 'teen',
    story_kind: 'mystery',
    emotional_effect: 'excitement',
    assist_mode: 'writer',
    ...identity
  }, 'writer');
}

test('unknown resume on a fresh database initializes schema and returns 404 without mutation', async () => {
  const db = createDb();
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: 'missing-run' },
    auth: { ...TEST_IDENTITY, workspace_ids: ['*'] },
    db,
    request_id: 'fresh-db-resume'
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Story Engine run not found.');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_engine_runs').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count, 0);
  db.close();
});

test('GET run is observational and cannot resume a Writer session', async () => {
  const db = createDb();
  const run = await writerRun(db);
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: run.run_id },
    auth: { ...TEST_IDENTITY, workspace_ids: ['*'] },
    db
  };

  await handlers.get('GET /api/story-engine/runs/:run_id')(req, res);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'writer_active');
  assert.equal(res.body.dispatch_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count, 0);
  db.close();
});

test('explicit resume is blocked for Writer before any provider/runtime work', async () => {
  const db = createDb();
  const run = await writerRun(db);
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: run.run_id },
    auth: { ...TEST_IDENTITY, workspace_ids: ['*'] },
    db
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'ASSIST_AUTHORITY_BLOCKS_AUTONOMOUS_RESUME');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count, 0);
  db.close();
});

test('workspace access is checked before resume can mutate a run', async () => {
  const db = createDb();
  const run = await writerRun(db);
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: run.run_id },
    auth: { tenant_id: 'tenant-other', actor_id: 'actor-other', role: 'creator', workspace_ids: [] },
    db,
    request_id: 'route-authority-test'
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count, 0);
  db.close();
});

test('run list and Story Engine brain are tenant scoped', async () => {
  const db = createDb();
  const runA = await writerRun(db, TEST_IDENTITY);
  const runB = await writerRun(db, { tenant_id: 'tenant-b', actor_id: 'actor-b', role: 'creator' });
  const handlers = captureRoutes(db);

  const listRes = responseRecorder();
  handlers.get('GET /api/story-engine/runs')({
    url: '/api/story-engine/runs',
    auth: { ...TEST_IDENTITY, workspace_ids: ['*'] },
    db
  }, listRes);
  assert.equal(listRes.status, 200);
  assert.deepEqual(listRes.body.map(item => item.run_id), [runA.run_id]);

  const brainRes = responseRecorder();
  handlers.get('GET /api/story-engine/brain')({
    auth: { ...TEST_IDENTITY, workspace_ids: ['*'] },
    db
  }, brainRes);
  assert.equal(brainRes.status, 200);
  assert.equal(brainRes.body.recent_runs.some(item => item.run_id === runA.run_id), true);
  assert.equal(brainRes.body.recent_runs.some(item => item.run_id === runB.run_id), false);
  assert.equal(brainRes.body.active_runs.some(item => item.run_id === runB.run_id), false);
  db.close();
});
