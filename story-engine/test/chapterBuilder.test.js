import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildStoryArchitecture } from '../lib/storyArchitect.js';
import { buildChapterDraft, buildAllChapterDrafts } from '../lib/chapterBuilder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-chapter-builder') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, schema_version, created_at, updated_at)
    VALUES (?, 'Chapter Builder Story', 'fantasy', 'A guarded hero must choose truth.', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (?, 'Healthy', 'third_person', 'opening', 4000, '{}', 1, ?)
  `).run(workspaceId, now);
  return workspaceId;
}

test('Chapter Builder creates a draft from planned architecture', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  buildStoryArchitecture(db, { workspace_id: workspaceId, chapter_count: 6 });

  const result = buildChapterDraft(db, {
    workspace_id: workspaceId,
    chapter_number: 1,
    word_target: 900
  });
  const memoryDiffs = db.prepare(`
    SELECT * FROM memory_diffs WHERE workspace_id = ? AND source IN ('chapter_save', 'chapter_builder')
  `).all(workspaceId);
  const dispatch = db.prepare(`
    SELECT * FROM runtime_dispatch_queue
    WHERE workspace_id = ? AND trigger_type = 'chapter_builder_drafted'
  `).get(workspaceId);

  assert.equal(result.action, 'created');
  assert.equal(result.chapter.position, 1);
  assert.equal(result.chapter.chapter_id, 'chapter-01');
  assert.match(result.chapter.content, /Target length: 900 words/);
  assert.ok(memoryDiffs.length >= 2);
  assert.ok(dispatch);
  db.close();
});

test('Chapter Builder is idempotent and updates an existing planned chapter', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  buildStoryArchitecture(db, { workspace_id: workspaceId, chapter_count: 6 });

  const first = buildChapterDraft(db, { workspace_id: workspaceId, chapter_number: 1 });
  const second = buildChapterDraft(db, { workspace_id: workspaceId, chapter_number: 1, content: 'Custom replacement draft.' });
  const rows = db.prepare('SELECT * FROM chapters WHERE workspace_id = ?').all(workspaceId);

  assert.equal(first.action, 'created');
  assert.equal(second.action, 'updated');
  assert.equal(first.chapter.id, second.chapter.id);
  assert.equal(rows.length, 1);
  assert.equal(second.chapter.content, 'Custom replacement draft.');
  db.close();
});

test('Chapter Builder can build all planned chapters', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  buildStoryArchitecture(db, { workspace_id: workspaceId, chapter_count: 6 });

  const results = buildAllChapterDrafts(db, { workspace_id: workspaceId, word_target: 700 });
  const rows = db.prepare('SELECT * FROM chapters WHERE workspace_id = ? ORDER BY position').all(workspaceId);

  assert.equal(results.length, 6);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].chapter_id, 'chapter-01');
  assert.equal(rows.at(-1).chapter_id, 'chapter-06');
  assert.ok(rows.every(row => row.content.includes('Target length: 700 words')));
  db.close();
});

test('Chapter Builder requires a Story Architecture', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  assert.throws(
    () => buildChapterDraft(db, { workspace_id: workspaceId, chapter_number: 1 }),
    /Story architecture not found/
  );
  db.close();
});
