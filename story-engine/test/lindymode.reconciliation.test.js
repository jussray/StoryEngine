import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { analyzeChapter } from '../lib/lindymodeProcessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seed(db) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES ('workspace-reconcile', 'Reconciliation Story', '1.0.0', ?, ?)
  `).run(now, now);

  const result = db.prepare(`
    INSERT INTO chapters (
      workspace_id, chapter_id, title, content, text, status, position, created_at, updated_at
    ) VALUES (
      'workspace-reconcile', 'chapter-reconcile', 'Chapter One',
      'I walked into the room.', '', 'Drafted', 0, ?, ?
    )
  `).run(now, now);

  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (
      'workspace-reconcile', 'Third person story', 'third_person', 'opening', 4000, '{}', 1, ?
    )
  `).run(now);

  return Number(result.lastInsertRowid);
}

test('chapter fix automatically resolves stale Lindymode incidents', () => {
  const db = createDb();
  const chapterId = seed(db);

  const firstChapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  const first = analyzeChapter(db, firstChapter, { correlation_id: 'corr-first' });

  assert.equal(first.incidents.length, 1);
  assert.equal(first.incidents[0].status, 'active');

  db.prepare(`
    UPDATE chapters
    SET content = 'She walked into the room.', updated_at = ?
    WHERE id = ?
  `).run(Date.now(), chapterId);

  const fixedChapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  const second = analyzeChapter(db, fixedChapter, { correlation_id: 'corr-fixed' });
  const active = db.prepare(`
    SELECT * FROM lindymode_incidents
    WHERE workspace_id = 'workspace-reconcile' AND status = 'active'
  `).all();
  const resolved = db.prepare(`
    SELECT * FROM lindymode_incidents
    WHERE workspace_id = 'workspace-reconcile' AND status = 'resolved'
  `).all();
  const event = db.prepare(`
    SELECT * FROM events
    WHERE event_type = 'lindymode.incidents_auto_resolved'
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  assert.equal(second.incidents.length, 0);
  assert.equal(second.resolved_incidents.length, 1);
  assert.equal(active.length, 0);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].recovery_action, 'author_fix_validated');
  assert.ok(event);

  db.close();
});
