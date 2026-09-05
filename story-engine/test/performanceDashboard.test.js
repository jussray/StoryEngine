import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildPerformanceDashboard } from '../lib/performanceDashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function isMetricWindowQuery(sql) {
  return /SELECT\s+workspace_id,\s*mode,\s*event_type,\s*duration_ms,\s*rollback\s+FROM events\s+WHERE created_at >= \?/s.test(sql);
}

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-performance') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES (?, 'Performance Story', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO chapters (
      workspace_id, chapter_id, title, content, text, status, position, created_at, updated_at
    ) VALUES (?, 'chapter-1', 'Chapter One', 'Text.', '', 'Drafted', 0, ?, ?)
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
    ) VALUES ('run-performance', 'corr-performance', ?, 'test', 'completed', '[]', '{}', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

function insertEvent(db, workspaceId, duration, eventType = 'operation.completed', rollback = 0) {
  db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES (?, 'chapter', ?, '{}', ?, ?, ?)
  `).run(workspaceId, eventType, duration, rollback, Date.now());
}

test('performance dashboard computes workspace p50, p99, ratio, and totals', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  [100, 200, 300, 400, 2500].forEach(ms => insertEvent(db, workspaceId, ms));

  const dashboard = buildPerformanceDashboard(db, { windowMs: 15 * 60 * 1000 });
  const workspace = dashboard.workspace_metrics.find(item => item.workspace_id === workspaceId);

  assert.equal(dashboard.overview.total_events, 5);
  assert.equal(dashboard.overview.latency_samples, 5);
  assert.equal(workspace.latency_sample_count, 5);
  assert.equal(workspace.p50, 300);
  assert.equal(workspace.p99, 2500);
  assert.equal(workspace.p99_ratio, 8.33);
  assert.equal(workspace.status, 'critical');
  db.close();
});

test('performance dashboard keeps missing latency evidence unknown instead of healthy', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  insertEvent(db, workspaceId, null);

  const dashboard = buildPerformanceDashboard(db);
  const workspace = dashboard.workspace_metrics.find(item => item.workspace_id === workspaceId);

  assert.equal(workspace.total_events, 1);
  assert.equal(workspace.latency_sample_count, 0);
  assert.equal(workspace.status, 'unknown');
  assert.equal(dashboard.overview.latency_samples, 0);
  assert.equal(dashboard.overview.max_p99, null);
  db.close();
});

test('performance dashboard still prioritizes known failures when latency evidence is missing', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  insertEvent(db, workspaceId, null, 'operation.failed', 0);

  const dashboard = buildPerformanceDashboard(db);
  const workspace = dashboard.workspace_metrics.find(item => item.workspace_id === workspaceId);

  assert.equal(workspace.latency_sample_count, 0);
  assert.equal(workspace.error_rate, 1);
  assert.equal(workspace.status, 'critical');
  db.close();
});

test('performance dashboard computes error and rollback rates', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  insertEvent(db, workspaceId, 100, 'operation.completed', 0);
  insertEvent(db, workspaceId, 150, 'operation.failed', 0);
  insertEvent(db, workspaceId, 200, 'operation.blocked', 1);
  insertEvent(db, workspaceId, 250, 'operation.completed', 0);

  const dashboard = buildPerformanceDashboard(db);
  const workspace = dashboard.workspace_metrics.find(item => item.workspace_id === workspaceId);

  assert.equal(workspace.error_rate, 0.5);
  assert.equal(workspace.rollback_rate, 0.25);
  assert.equal(dashboard.overview.error_rate, 0.5);
  assert.equal(dashboard.overview.rollback_rate, 0.25);
  db.close();
});

test('performance dashboard includes Release Gate pressure', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  insertEvent(db, workspaceId, 100);
  db.prepare(`
    INSERT INTO memory_diffs (
      diff_id, workspace_id, chapter_id, entity_type, entity_id, field,
      old_value, new_value, conflict, resolved, source, created_at
    ) VALUES ('diff-performance', ?, 1, 'character', 'mara', 'location', 'city-b', 'city-a', 1, 0, 'test', ?)
  `).run(workspaceId, Date.now());

  const dashboard = buildPerformanceDashboard(db);

  assert.equal(dashboard.overview.gate_blocked, 1);
  assert.equal(dashboard.gate_pressure.blocked, 1);
  assert.equal(dashboard.gate_pressure.gates[0].status, 'BLOCKED');
  assert.ok(dashboard.incidents.some(item => item.event_type === 'GENOME_DRIFT'));
  db.close();
});

test('default performance dashboard reuses its OODA metric window for incidents', () => {
  const raw = createDb();
  let metricScans = 0;
  const db = {
    exec(sql) {
      return raw.exec(sql);
    },
    prepare(sql) {
      if (isMetricWindowQuery(sql)) metricScans += 1;
      return raw.prepare(sql);
    }
  };
  const workspaceId = seedWorkspace(db);
  insertEvent(db, workspaceId, 120);

  const dashboard = buildPerformanceDashboard(db);
  assert.equal(metricScans, 1);
  assert.equal(dashboard.endpoint_metrics.length, 1);
  raw.close();
});

test('custom performance window preserves the independent default OODA incident window', () => {
  const raw = createDb();
  let metricScans = 0;
  const db = {
    exec(sql) {
      return raw.exec(sql);
    },
    prepare(sql) {
      if (isMetricWindowQuery(sql)) metricScans += 1;
      return raw.prepare(sql);
    }
  };
  const workspaceId = seedWorkspace(db);
  insertEvent(db, workspaceId, 120);

  buildPerformanceDashboard(db, { windowMs: 5 * 60 * 1000 });
  assert.equal(metricScans, 2);
  raw.close();
});
