import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildControlRoomOverview,
  resolveControlRoomIncident,
  forceControlRoomGatePass
} from '../routes/controlRoom.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-control-room') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES (?, 'Control Room Story', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO chapters (
      workspace_id, chapter_id, title, content, text, status, position, created_at, updated_at
    ) VALUES (?, 'chapter-1', 'Chapter One', 'She entered the room.', '', 'Drafted', 0, ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (?, 'Healthy', 'third_person', 'opening', 4000, '{}', 1, ?)
  `).run(workspaceId, now);
  db.prepare(`
    INSERT INTO autonomous_runtime_runs (
      run_id, correlation_id, workspace_id, trigger_type, status,
      steps_json, result_json, created_at, completed_at
    ) VALUES ('run-control-room', 'corr-control-room', ?, 'test', 'completed', '[]', '{}', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

test('overview works when memory tables are empty', () => {
  const db = createDb();
  seedWorkspace(db);

  const overview = buildControlRoomOverview(db);

  assert.equal(overview.memory.story_drift_count, 0);
  assert.equal(overview.memory.engine_drift_count, 0);
  assert.equal(overview.memory.lessons_today, 0);
  assert.deepEqual(overview.memory.story_conflicts, []);
  assert.deepEqual(overview.memory.confidence_trend, []);
  assert.ok(Array.isArray(overview.pipeline_health));
  db.close();
});

test('memory_diffs conflicts appear as story drift', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const now = Date.now();

  db.prepare(`
    INSERT INTO memory_diffs (
      workspace_id, chapter_id, entity_type, entity_id, field,
      old_value, new_value, conflict, resolved, created_at
    ) VALUES (?, 1, 'character', 'mara', 'location', 'City B', 'City A', 1, 0, ?)
  `).run(workspaceId, now);

  const overview = buildControlRoomOverview(db, now);

  assert.equal(overview.memory.story_drift_count, 1);
  assert.equal(overview.memory.story_conflicts.length, 1);
  assert.equal(overview.memory.story_conflicts[0].entity_id, 'mara');
  db.close();
});

test('engine memory repeated mistakes appear as engine drift', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const now = Date.now();

  db.prepare(`
    INSERT INTO engine_memory_episodes (
      episode_id, workspace_id, chapter_id, lessons_json,
      repeated_mistake, confidence_before, confidence_after, created_at
    ) VALUES ('episode-control-room', ?, 1, ?, 1, 71, 82, ?)
  `).run(workspaceId, JSON.stringify(['Increase Act II tension.']), now);

  const overview = buildControlRoomOverview(db, now);

  assert.equal(overview.memory.engine_drift_count, 1);
  assert.equal(overview.memory.repeated_mistake_count, 1);
  assert.equal(overview.memory.lessons_today, 1);
  assert.equal(overview.memory.recent_lessons.length, 1);
  assert.equal(overview.memory.confidence_trend.at(-1).confidence_after, 82);
  db.close();
});

test('resolve incident marks a memory diff resolved', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const now = Date.now();

  const inserted = db.prepare(`
    INSERT INTO memory_diffs (
      workspace_id, chapter_id, entity_type, entity_id, field,
      old_value, new_value, conflict, resolved, created_at
    ) VALUES (?, 1, 'character', 'mara', 'location', 'City B', 'City A', 1, 0, ?)
  `).run(workspaceId, now);

  const result = resolveControlRoomIncident(db, {
    diff_id: Number(inserted.lastInsertRowid),
    resolution: 'Author confirmed travel occurred between scenes.'
  });
  const diff = db.prepare('SELECT * FROM memory_diffs WHERE id = ?')
    .get(Number(inserted.lastInsertRowid));

  assert.equal(result.ok, true);
  assert.equal(result.resolved, 1);
  assert.equal(diff.resolved, 1);
  assert.match(diff.resolution, /confirmed travel/);
  assert.ok(diff.resolved_at);
  db.close();
});

test('force gate pass writes an OPERATOR_OVERRIDE audit', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const result = forceControlRoomGatePass(db, {
    workspace_id: workspaceId,
    chapter_id: 1,
    operator_note: 'Approved after manual continuity review.'
  });
  const audit = db.prepare('SELECT * FROM release_audits WHERE audit_id = ?').get(result.audit_id);
  const checks = JSON.parse(audit.checks_json);

  assert.equal(result.result, 'OPERATOR_OVERRIDE');
  assert.equal(audit.result, 'OPERATOR_OVERRIDE');
  assert.equal(audit.confidence_score, 100);
  assert.equal(checks[0].check, 'operator_override');
  assert.match(checks[0].note, /manual continuity review/);
  db.close();
});
