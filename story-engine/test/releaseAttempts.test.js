import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createReleaseAttempt,
  completeReleaseAttempt,
  failReleaseAttempt,
  listReleaseAttempts
} from '../lib/releaseAttempts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-attempt') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES (?, 'Attempt Story', '1.0.0', ?, ?)
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
    ) VALUES ('run-attempt', 'corr-attempt', ?, 'test', 'completed', '[]', '{}', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

test('healthy workspace can create and complete a release attempt', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const created = createReleaseAttempt(db, workspaceId, 'movie_beats_generate');
  assert.equal(created.allowed, true);
  assert.equal(created.attempt.status, 'running');
  assert.ok(created.attempt.gate_audit_id);

  const completed = completeReleaseAttempt(db, created.attempt.attempt_id, { beat_count: 3 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.beat_count, 3);

  const events = db.prepare(`
    SELECT event_type FROM events
    WHERE workspace_id = ? AND mode = 'release_attempt'
    ORDER BY id
  `).all(workspaceId).map(row => row.event_type);
  assert.deepEqual(events, ['release_attempt_started', 'release_attempt_completed']);
  db.close();
});

test('blocked gate creates a blocked release attempt', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const now = Date.now();

  db.prepare(`
    INSERT INTO lindymode_incidents (
      incident_id, correlation_id, workspace_id, chapter_id, event_type,
      severity, status, reason, drift_score, details_json, created_at
    ) VALUES (
      'attempt-blocker', 'attempt-correlation', ?, 1, 'lindymode.continuity_conflict',
      'sev3', 'active', 'Continuity conflict', 0.9, '{}', ?
    )
  `).run(workspaceId, now);

  const created = createReleaseAttempt(db, workspaceId, 'movie_beats_generate');
  assert.equal(created.allowed, false);
  assert.equal(created.attempt.status, 'blocked');
  assert.equal(created.attempt.gate_status, 'BLOCKED');
  assert.ok(created.attempt.completed_at);
  db.close();
});

test('running attempt can be marked failed', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const created = createReleaseAttempt(db, workspaceId, 'export');

  const failed = failReleaseAttempt(db, created.attempt.attempt_id, new Error('Renderer stopped'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Renderer stopped');
  assert.equal(listReleaseAttempts(db, workspaceId).length, 1);
  db.close();
});

test('completing an already completed attempt is idempotent', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const created = createReleaseAttempt(db, workspaceId, 'export');

  completeReleaseAttempt(db, created.attempt.attempt_id, { file: 'draft.pdf' });
  const repeated = completeReleaseAttempt(db, created.attempt.attempt_id, { file: 'other.pdf' });
  const completionEvents = db.prepare(`
    SELECT COUNT(*) AS count FROM events
    WHERE workspace_id = ? AND event_type = 'release_attempt_completed'
  `).get(workspaceId);

  assert.equal(repeated.status, 'completed');
  assert.equal(repeated.result.file, 'draft.pdf');
  assert.equal(Number(completionEvents.count), 1);
  db.close();
});

test('terminal attempts reject conflicting transitions', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const completedAttempt = createReleaseAttempt(db, workspaceId, 'export');
  completeReleaseAttempt(db, completedAttempt.attempt.attempt_id, {});

  assert.throws(
    () => failReleaseAttempt(db, completedAttempt.attempt.attempt_id, 'late failure'),
    error => error.code === 'INVALID_RELEASE_ATTEMPT_TRANSITION'
  );

  const failedAttempt = createReleaseAttempt(db, workspaceId, 'publish');
  failReleaseAttempt(db, failedAttempt.attempt.attempt_id, 'publish failed');

  assert.throws(
    () => completeReleaseAttempt(db, failedAttempt.attempt.attempt_id, {}),
    error => error.code === 'INVALID_RELEASE_ATTEMPT_TRANSITION'
  );

  db.close();
});
