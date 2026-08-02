import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  setCanonAnchor, lockCanonAnchor, getCanonAnchor,
  listCanonAnchors, canonSnapshot, evaluateCanonFit
} from '../lib/canonMemory.js';

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

test('setCanonAnchor creates and retrieves an anchor', () => {
  const db = makeDb();
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'character', key: 'protagonist_name', value: 'Maya' });
  const a = getCanonAnchor(db, 'ws1', 'character', 'protagonist_name');
  assert.ok(a);
  assert.strictEqual(a.value, 'Maya');
  assert.strictEqual(a.locked, 0);
});

test('setCanonAnchor updates an existing anchor', () => {
  const db = makeDb();
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'character', key: 'protagonist_name', value: 'Maya' });
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'character', key: 'protagonist_name', value: 'Maya Chen' });
  const a = getCanonAnchor(db, 'ws1', 'character', 'protagonist_name');
  assert.strictEqual(a.value, 'Maya Chen');
});

test('lockCanonAnchor prevents AI overwrite', () => {
  const db = makeDb();
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic does not exist in this world.', locked: false });
  lockCanonAnchor(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic' });
  assert.throws(() => {
    setCanonAnchor(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'no_magic', value: 'Magic exists.', source: 'ai' });
  }, /locked/);
});

test('canonSnapshot groups anchors by kind', () => {
  const db = makeDb();
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'character', key: 'name', value: 'Maya' });
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'world_rule', key: 'rule1', value: 'No flying.' });
  setCanonAnchor(db, { workspace_id: 'ws1', kind: 'tone_constant', key: 'mood', value: 'hopeful' });
  const snap = canonSnapshot(db, 'ws1');
  assert.strictEqual(snap.anchor_count, 3);
  assert.ok(snap.anchors.character);
  assert.ok(snap.anchors.world_rule);
  assert.ok(snap.anchors.tone_constant);
});

test('evaluateCanonFit passes when no anchors set', () => {
  const db = makeDb();
  const result = evaluateCanonFit(db, 'ws_empty', 'Some draft text here.');
  assert.ok(result.passed);
  assert.strictEqual(result.anchor_count, 0);
});

test('evaluateCanonFit detects world rule possible contradiction', () => {
  const db = makeDb();
  setCanonAnchor(db, { workspace_id: 'ws2', kind: 'world_rule', key: 'magic_rule', value: 'Magic does not exist in this story world.' });
  const draft = 'There was no magic in the valley, or so they thought. She cast a spell and the stones flew.';
  const result = evaluateCanonFit(db, 'ws2', draft);
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.some(c => c.includes('world_rule')));
});

test('evaluateCanonFit surfaces tone constant as info reminder', () => {
  const db = makeDb();
  setCanonAnchor(db, { workspace_id: 'ws3', kind: 'tone_constant', key: 'mood', value: 'hopeful' });
  const result = evaluateCanonFit(db, 'ws3', 'The city was cold and dark and everyone was suffering.');
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.includes('canon_tone_reminder'));
});
