import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluateReleaseGate } from '../lib/releaseGate.js';
import { enqueueRuntime } from '../lib/runtimeDispatcher.js';
import { getRetentionStatus, runEventRetention } from '../lib/eventRetention.js';
import { upsertCreativeProfile } from '../lib/creativeProfile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

function seedHealthyWorkspace(db, workspaceId = 'workspace-test') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (
      workspace_id, title, genre, pitch, schema_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '1.0.0', ?, ?)
  `).run(workspaceId, 'Test Story', 'Drama', 'A test story.', now, now);

  db.prepare(`
    INSERT INTO chapters (
      workspace_id, chapter_id, title, content, text, status, position, created_at, updated_at
    ) VALUES (?, 'chapter-1', 'Chapter One', 'A complete opening chapter.', '', 'Drafted', 0, ?, ?)
  `).run(workspaceId, now, now);

  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (?, 'Healthy summary', 'third_person', 'opening', 4000, '{}', 1, ?)
  `).run(workspaceId, now);

  db.prepare(`
    INSERT INTO autonomous_runtime_runs (
      run_id, correlation_id, workspace_id, chapter_id, trigger_type,
      status, steps_json, result_json, created_at, completed_at
    ) VALUES ('run-1', 'corr-runtime-1', ?, 1, 'test', 'completed', '[]', '{}', ?, ?)
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

test('Release Gate reports READY for a healthy workspace', () => {
  const db = createDb();
  const workspaceId = seedHealthyWorkspace(db);

  const gate = evaluateReleaseGate(db, workspaceId);

  assert.equal(gate.status, 'READY');
  assert.equal(gate.blockers.length, 0);
  assert.equal(gate.warnings.length, 0);
  assert.equal(gate.metrics.runtime_status, 'completed');
  db.close();
});

test('Release Gate blocks active Sev3 continuity conflicts', () => {
  const db = createDb();
  const workspaceId = seedHealthyWorkspace(db);
  const now = Date.now();

  db.prepare(`
    INSERT INTO lindymode_incidents (
      incident_id, correlation_id, workspace_id, chapter_id, event_type,
      severity, status, reason, drift_score, details_json, created_at
    ) VALUES (
      'incident-sev3', 'corr-sev3', ?, 1, 'lindymode.continuity_conflict',
      'sev3', 'active', 'POV conflict', 0.9, '{}', ?
    )
  `).run(workspaceId, now);

  const gate = evaluateReleaseGate(db, workspaceId);

  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.metrics.sev3_incidents, 1);
  assert.equal(gate.metrics.unresolved_continuity_conflicts, 1);
  assert.ok(gate.blockers.some(item => item.includes('Sev3')));
  db.close();
});

test('Runtime dispatch deduplicates unchanged chapter state', () => {
  const db = createDb();
  const workspaceId = seedHealthyWorkspace(db);

  const first = enqueueRuntime(db, workspaceId, 'chapter_updated', 1);
  const second = enqueueRuntime(db, workspaceId, 'chapter_updated', 1);

  assert.ok(first.dispatch_id);
  assert.equal(first.status, 'queued');
  assert.equal(second.dispatch_id, first.dispatch_id);
  assert.equal(second.deduplicated, true);
  db.close();
});

test('Retention compacts resolved correlations and preserves active incident correlations', () => {
  const db = createDb();
  const workspaceId = seedHealthyWorkspace(db);
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;

  const insertEvent = db.prepare(`
    INSERT INTO events (
      workspace_id, mode, event_type, payload, duration_ms, rollback, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertEvent.run(workspaceId, 'ooda', 'runtime.step.one', JSON.stringify({ correlation_id: 'corr-safe' }), 10, 0, old);
  insertEvent.run(workspaceId, 'ooda', 'runtime.step.two', JSON.stringify({ correlation_id: 'corr-safe' }), 20, 0, old + 1);
  insertEvent.run(workspaceId, 'lindymode', 'runtime.step.active', JSON.stringify({ correlation_id: 'corr-active' }), 30, 0, old + 2);

  db.prepare(`
    INSERT INTO lindymode_incidents (
      incident_id, correlation_id, workspace_id, chapter_id, event_type,
      severity, status, reason, drift_score, details_json, created_at
    ) VALUES (
      'incident-active', 'corr-active', ?, 1, 'lindymode.state_drift_detected',
      'sev2', 'active', 'Active drift', 0.5, '{}', ?
    )
  `).run(workspaceId, old + 2);

  const result = runEventRetention(db, { keepMs: 7 * 24 * 60 * 60 * 1000, limit: 100 });
  const remaining = db.prepare("SELECT payload FROM events WHERE event_type LIKE 'runtime.%' ORDER BY id").all();
  const compacted = db.prepare('SELECT * FROM compacted_event_episodes').all();
  const status = getRetentionStatus(db);

  assert.equal(result.compacted_groups, 1);
  assert.equal(result.deleted_events, 2);
  assert.equal(result.skipped_groups, 1);
  assert.equal(remaining.length, 1);
  assert.match(remaining[0].payload, /corr-active/);
  assert.equal(compacted.length, 1);
  assert.equal(compacted[0].correlation_id, 'corr-safe');
  assert.equal(status.compacted_episode_count, 1);
  db.close();
});
