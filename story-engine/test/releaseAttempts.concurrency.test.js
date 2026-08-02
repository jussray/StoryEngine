import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createReleaseAttempt,
  reconcileStaleReleaseAttempts
} from '../lib/releaseAttempts.js';
import { upsertCreativeProfile } from '../lib/creativeProfile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-concurrency') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES (?, 'Concurrency Story', '1.0.0', ?, ?)
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
    ) VALUES ('run-concurrency', 'corr-concurrency', ?, 'test', 'completed', '[]', '{}', ?, ?)
  `).run(workspaceId, now, now);
  upsertCreativeProfile(db, workspaceId, {
    story_vision: 'A complete test story about courage and belonging.',
    story_kind: 'drama',
    emotional_effect: 'hope',
    medium: 'book',
    audience: 'adult',
    goal: 'entertain',
  });

  return workspaceId;
}

test('duplicate running operations reuse the existing attempt', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const first = createReleaseAttempt(db, workspaceId, 'movie_beats_generate');
  const second = createReleaseAttempt(db, workspaceId, 'movie_beats_generate');

  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(second.attempt.attempt_id, first.attempt.attempt_id);

  const attempts = db.prepare(`
    SELECT COUNT(*) AS count FROM release_attempts
    WHERE workspace_id = ? AND operation = 'movie_beats_generate'
  `).get(workspaceId);
  const startEvents = db.prepare(`
    SELECT COUNT(*) AS count FROM events
    WHERE workspace_id = ? AND event_type = 'release_attempt_started'
  `).get(workspaceId);

  assert.equal(Number(attempts.count), 1);
  assert.equal(Number(startEvents.count), 1);
  db.close();
});

test('different operations can run concurrently', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const movie = createReleaseAttempt(db, workspaceId, 'movie_beats_generate');
  const exportAttempt = createReleaseAttempt(db, workspaceId, 'export');

  assert.notEqual(movie.attempt.attempt_id, exportAttempt.attempt.attempt_id);
  assert.equal(movie.deduplicated, false);
  assert.equal(exportAttempt.deduplicated, false);
  db.close();
});

test('stale running attempts time out and allow a new attempt', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const first = createReleaseAttempt(db, workspaceId, 'movie_beats_generate');

  db.prepare(`
    UPDATE release_attempts SET created_at = ? WHERE attempt_id = ?
  `).run(Date.now() - 20 * 60 * 1000, first.attempt.attempt_id);

  const second = createReleaseAttempt(db, workspaceId, 'movie_beats_generate', {
    staleAfterMs: 15 * 60 * 1000
  });
  const stale = db.prepare(`
    SELECT * FROM release_attempts WHERE attempt_id = ?
  `).get(first.attempt.attempt_id);
  const timeoutEvents = db.prepare(`
    SELECT COUNT(*) AS count FROM events
    WHERE workspace_id = ? AND event_type = 'release_attempt_timed_out'
  `).get(workspaceId);

  assert.equal(stale.status, 'failed');
  assert.match(stale.error, /timed out/);
  assert.equal(second.deduplicated, false);
  assert.notEqual(second.attempt.attempt_id, first.attempt.attempt_id);
  assert.equal(Number(timeoutEvents.count), 1);
  db.close();
});

test('manual stale reconciliation is idempotent', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const attempt = createReleaseAttempt(db, workspaceId, 'export');
  db.prepare(`UPDATE release_attempts SET created_at = ? WHERE attempt_id = ?`)
    .run(Date.now() - 20 * 60 * 1000, attempt.attempt.attempt_id);

  const first = reconcileStaleReleaseAttempts(db, { staleAfterMs: 15 * 60 * 1000 });
  const second = reconcileStaleReleaseAttempts(db, { staleAfterMs: 15 * 60 * 1000 });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  db.close();
});
