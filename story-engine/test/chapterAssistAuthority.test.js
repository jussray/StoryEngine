import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import chapterRoutes from '../routes/chapters.js';
import * as Story from '../models/storyModel.js';
import { setWorkspaceAssist } from '../lib/assistMode.js';

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
    post(path, handler) { handlers.set(`POST ${path}`, handler); },
    put(path, handler) { handlers.set(`PUT ${path}`, handler); }
  };
  chapterRoutes(router, db);
  return handlers;
}

function responseRecorder() {
  return {
    writableEnded: false,
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) {
      this.body = JSON.parse(body);
      this.writableEnded = true;
    }
  };
}

function createWorkspace(db, assistMode) {
  const workspaceId = Story.create(db, {
    title: `${assistMode} story`,
    genre: 'fantasy',
    pitch: 'A creator-owned story.'
  });
  setWorkspaceAssist(db, workspaceId, { assist_mode: assistMode });
  return workspaceId;
}

function runtimeDispatchCount(db) {
  const exists = db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='runtime_dispatch_queue'
  `).get();
  if (!exists) return 0;
  return db.prepare('SELECT COUNT(*) AS count FROM runtime_dispatch_queue').get().count;
}

function createChapter(handlers, workspaceId, title = 'Chapter One') {
  const res = responseRecorder();
  handlers.get('POST /api/chapters/:workspace_id')({
    params: { workspace_id: workspaceId },
    body: { title, content: 'Human-authored opening line.', position: 0 }
  }, res);
  return res;
}

test('Writer chapter create and save persist human text without autonomous runtime dispatch', () => {
  const db = createDb();
  const workspaceId = createWorkspace(db, 'writer');
  const handlers = captureRoutes(db);

  const created = createChapter(handlers, workspaceId);
  assert.equal(created.status, 201);
  assert.equal(created.body.queued, false);
  assert.equal(created.body.dispatch, null);
  assert.equal(runtimeDispatchCount(db), 0);

  const chapter = db.prepare('SELECT * FROM chapters WHERE id=?').get(created.body.id);
  assert.equal(chapter.content, 'Human-authored opening line.');
  assert.ok(db.prepare(`
    SELECT 1 FROM memory_diffs
    WHERE workspace_id=? AND chapter_id=? AND source='chapter_save'
  `).get(workspaceId, created.body.id));

  const updated = responseRecorder();
  handlers.get('PUT /api/chapters/:id')({
    params: { id: String(created.body.id) },
    auth: { workspace_ids: ['*'] },
    body: { title: 'Chapter One', content: 'Human-authored revised line.' }
  }, updated);

  assert.equal(updated.status, 200);
  assert.equal(updated.body.queued, false);
  assert.equal(updated.body.dispatch, null);
  assert.equal(runtimeDispatchCount(db), 0);
  assert.equal(db.prepare('SELECT content FROM chapters WHERE id=?').get(created.body.id).content, 'Human-authored revised line.');
  db.close();
});

test('Co-Writer chapter create stays local until an explicit assist action', () => {
  const db = createDb();
  const workspaceId = createWorkspace(db, 'co_writer');
  const handlers = captureRoutes(db);

  const created = createChapter(handlers, workspaceId);
  assert.equal(created.status, 201);
  assert.equal(created.body.queued, false);
  assert.equal(created.body.dispatch, null);
  assert.equal(runtimeDispatchCount(db), 0);
  db.close();
});

test('Director chapter create preserves the existing autonomous runtime queue path for Gate B review', () => {
  const db = createDb();
  const workspaceId = createWorkspace(db, 'director');
  const handlers = captureRoutes(db);

  const created = createChapter(handlers, workspaceId);
  assert.equal(created.status, 202);
  assert.equal(created.body.queued, true);
  assert.ok(created.body.dispatch?.dispatch_id);
  assert.equal(runtimeDispatchCount(db), 1);
  db.close();
});
