import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import assistModeRoutes from '../routes/assistMode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function captureRoutes(db) {
  const routes = new Map();
  const router = {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    put(path, handler) { routes.set(`PUT ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); }
  };
  assistModeRoutes(router, db);
  return routes;
}

function responseRecorder() {
  return {
    statusCode: null,
    body: '',
    writableEnded: false,
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(chunk = '') { this.body += String(chunk); this.writableEnded = true; }
  };
}

test('creator may read but may not mutate the operator assist default', () => {
  const db = createDb();
  const routes = captureRoutes(db);

  const readReq = { auth: { role: 'creator' }, request_id: 'read_default' };
  const readRes = responseRecorder();
  routes.get('GET /api/control-room/operator/assist-default')(readReq, readRes);
  assert.equal(readRes.statusCode, 200);
  assert.equal(JSON.parse(readRes.body).default_assist_mode, 'writer');

  const writeReq = {
    auth: { role: 'creator' },
    request_id: 'write_default',
    body: { default_assist_mode: 'autonomous_studio' }
  };
  const writeRes = responseRecorder();
  routes.get('PUT /api/control-room/operator/assist-default')(writeReq, writeRes);
  assert.equal(writeRes.statusCode, 403);
  assert.equal(JSON.parse(writeRes.body).error, 'forbidden');

  const after = routes.get('GET /api/control-room/operator/assist-default');
  const afterRes = responseRecorder();
  after(readReq, afterRes);
  assert.equal(JSON.parse(afterRes.body).default_assist_mode, 'writer');
  db.close();
});

test('administrator may mutate the operator assist default', () => {
  const db = createDb();
  const routes = captureRoutes(db);
  const req = {
    auth: { role: 'administrator' },
    request_id: 'admin_default',
    body: { default_assist_mode: 'director' }
  };
  const res = responseRecorder();
  routes.get('PUT /api/control-room/operator/assist-default')(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).default_assist_mode, 'director');
  db.close();
});
