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
    auth: { workspace_ids: ['*'] }
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
    auth: { workspace_ids: [] },
    request_id: 'route-authority-test'
  };

  await handlers.get('POST /api/story-engine/runs/:run_id/resume')(req, res);

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'workspace_forbidden');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count, 0);
  db.close();
});
