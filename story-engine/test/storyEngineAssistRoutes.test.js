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

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function tableRowCount(db, tableName) {
  const exists = db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type='table' AND name=?
  `).get(tableName);
  if (!exists) return 0;
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
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

async function writerRun(db) {
  return startHumanLedStoryEngineRun(db, {
    story_vision: 'Write a mystery podcast for teens.',
    medium: 'podcast',
    audience: 'teen',
    story_kind: 'mystery',
    emotional_effect: 'excitement',
    assist_mode: 'writer'
  }, 'writer');
}

test('unknown resume on a fresh database initializes schema and returns 404 without mutation', async () => {
  const db = createDb();
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: 'missing-run' },
    auth: { workspace_ids: ['*'] },
    request_id: 'fresh-db-resume'
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Story Engine run not found.');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_engine_runs').get().count, 0);
  assert.equal(tableRowCount(db, 'runtime_dispatch_queue'), 0);
  db.close();
});

test('GET run is observational and cannot resume a Writer session', async () => {
  const db = createDb();
  const run = await writerRun(db);
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: run.run_id },
    auth: { workspace_ids: ['*'] }
  };

  await handlers.get('GET /api/story-engine/runs/:run_id')(req, res);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'writer_active');
  assert.equal(res.body.dispatch_id, null);
  assert.equal(tableRowCount(db, 'runtime_dispatch_queue'), 0);
  db.close();
});

test('explicit resume is blocked for Writer before any provider/runtime work', async () => {
  const db = createDb();
  const run = await writerRun(db);
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: run.run_id },
    auth: { workspace_ids: ['*'] }
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'ASSIST_AUTHORITY_BLOCKS_AUTONOMOUS_RESUME');
  assert.equal(tableRowCount(db, 'runtime_dispatch_queue'), 0);
  db.close();
});

test('workspace access is checked before resume can mutate a run', async () => {
  const db = createDb();
  const run = await writerRun(db);
  const handlers = captureRoutes(db);
  const res = responseRecorder();
  const req = {
    params: { run_id: run.run_id },
    auth: { workspace_ids: [] },
    request_id: 'route-authority-test'
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
  assert.equal(tableRowCount(db, 'runtime_dispatch_queue'), 0);
  db.close();
});
