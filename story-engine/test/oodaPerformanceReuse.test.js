import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { collectActiveIncidents, computeMetrics } from '../lib/oodaProcessor.js';
import { getMissionControlSnapshot } from '../lib/missionControl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function isMetricWindowQuery(sql) {
  return /SELECT\s+workspace_id,\s*mode,\s*event_type,\s*duration_ms,\s*rollback\s+FROM events\s+WHERE created_at >= \?/s.test(sql);
}

test('computeMetrics preserves percentile truth without a second JavaScript sort', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE events (
      workspace_id TEXT,
      mode TEXT,
      event_type TEXT,
      duration_ms INTEGER,
      rollback INTEGER,
      created_at INTEGER
    );
  `);
  const insert = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, duration_ms, rollback, created_at)
    VALUES ('workspace-1', 'chapter', 'operation.completed', ?, 0, ?)
  `);
  const now = Date.now();
  [400, 100, 2500, 300, 200].forEach(duration => insert.run(duration, now));

  const [metrics] = computeMetrics(db);
  assert.equal(metrics.p50, 300);
  assert.equal(metrics.p95, 2500);
  assert.equal(metrics.p99, 2500);
  db.close();
});

test('collectActiveIncidents accepts precomputed metrics without rescanning events', () => {
  let metricScans = 0;
  const db = {
    prepare(sql) {
      if (isMetricWindowQuery(sql)) {
        metricScans += 1;
        throw new Error('unexpected duplicate metric scan');
      }
      if (sql.includes('FROM lindymode_incidents') || sql.includes('FROM memory_diffs')) {
        return { all: () => [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const metrics = [{
    workspace_id: 'workspace-1',
    mode: 'chapter',
    total_events: 5,
    p50: 300,
    p95: 2500,
    p99: 2500,
    rollback_rate: 0
  }];

  const incidents = collectActiveIncidents(db, undefined, metrics);
  assert.equal(metricScans, 0);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].workspace_id, 'workspace-1');
  assert.equal(incidents[0].severity, 'critical');
});

test('Mission Control performs one OODA metric-window scan per snapshot', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(schema);
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

  const snapshot = getMissionControlSnapshot(db);
  assert.equal(metricScans, 1);
  assert.deepEqual(snapshot.metrics, []);
  assert.deepEqual(snapshot.incidents, []);
  raw.close();
});
