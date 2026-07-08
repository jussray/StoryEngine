import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createRouter, json } from '../lib/miniRouter.js';
import { requireAuth } from '../lib/requireAuth.js';
import { patchMemoryFromChapter } from '../lib/memoryEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writableEnded: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += String(chunk);
      this.writableEnded = true;
    }
  };
}

function request(method, url, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.resume = () => {};
  return req;
}

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('requireAuth rejects missing or incorrect API keys', () => {
  const original = process.env.API_KEY;
  process.env.API_KEY = 'correct-secret';
  try {
    for (const headers of [{}, { 'x-api-key': 'wrong-secret' }]) {
      const req = request('GET', '/api/health', headers);
      const res = responseRecorder();
      let called = false;
      requireAuth(req, res, () => { called = true; });
      assert.equal(called, false);
      assert.equal(res.statusCode, 401);
      assert.equal(JSON.parse(res.body).error, 'unauthorized');
    }
  } finally {
    if (original === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = original;
  }
});

test('requireAuth accepts header, bearer token, and browser cookie', () => {
  const original = process.env.API_KEY;
  process.env.API_KEY = 'correct-secret';
  try {
    const cases = [
      { 'x-api-key': 'correct-secret' },
      { authorization: 'Bearer correct-secret' },
      { cookie: 'other=value; l99_api_key=correct-secret' }
    ];
    for (const headers of cases) {
      const req = request('GET', '/api/health', headers);
      const res = responseRecorder();
      let called = false;
      requireAuth(req, res, () => { called = true; });
      assert.equal(called, true);
      assert.equal(res.writableEnded, false);
    }
  } finally {
    if (original === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = original;
  }
});

test('router rejects unauthenticated requests before body-size processing', () => {
  const original = process.env.API_KEY;
  process.env.API_KEY = 'correct-secret';
  try {
    const router = createRouter({ maxBodyBytes: 8 });
    router.use('/api', requireAuth);
    router.post('/api/write', (req, res) => json(res, 200, { ok: true }));

    const req = request('POST', '/api/write', { 'content-length': '999999' });
    const res = responseRecorder();
    router.handle(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'unauthorized');
  } finally {
    if (original === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = original;
  }
});

test('router returns 413 for authenticated bodies over the configured limit', () => {
  const original = process.env.API_KEY;
  process.env.API_KEY = 'correct-secret';
  try {
    const router = createRouter({ maxBodyBytes: 8 });
    router.use('/api', requireAuth);
    router.post('/api/write', (req, res) => json(res, 200, { ok: true }));

    const req = request('POST', '/api/write', {
      'x-api-key': 'correct-secret',
      'content-length': '20'
    });
    const res = responseRecorder();
    router.handle(req, res);

    assert.equal(res.statusCode, 413);
    assert.equal(JSON.parse(res.body).error, 'body_too_large');
    assert.equal(JSON.parse(res.body).max_bytes, 8);
  } finally {
    if (original === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = original;
  }
});

test('patchMemoryFromChapter skips an identical chapter retry and its patches', () => {
  const db = createDb();
  const patches = [{
    entity_type: 'character',
    entity_id: 'mara',
    field: 'location',
    old_value: 'city-b',
    new_value: 'city-a',
    conflict: true
  }];

  const first = patchMemoryFromChapter(db, 'workspace-idempotent', 1, 'Same chapter text.', patches);
  const second = patchMemoryFromChapter(db, 'workspace-idempotent', 1, 'Same chapter text.', patches);
  const rows = db.prepare(`
    SELECT * FROM memory_diffs
    WHERE workspace_id = 'workspace-idempotent' AND chapter_id = 1
  `).all();

  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => row.field === 'content_hash').length, 1);
  assert.equal(rows.filter(row => row.conflict === 1).length, 1);
  db.close();
});

test('idempotency remains scoped by workspace and chapter', () => {
  const db = createDb();
  const text = 'Reusable chapter text.';

  assert.equal(patchMemoryFromChapter(db, 'workspace-a', 1, text).length, 1);
  assert.equal(patchMemoryFromChapter(db, 'workspace-a', 2, text).length, 1);
  assert.equal(patchMemoryFromChapter(db, 'workspace-b', 1, text).length, 1);

  const rows = db.prepare(`SELECT * FROM memory_diffs WHERE field = 'content_hash'`).all();
  assert.equal(rows.length, 3);
  db.close();
});
