import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectActiveIncidents } from '../lib/oodaProcessor.js';
import { startOodaWorkerLoop } from '../lib/oodaWorkerLoop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function normalizeIncidents(incidents) {
  return incidents.map(incident => ({
    incident_id: incident.incident_id,
    source: incident.source,
    workspace_id: incident.workspace_id,
    mode: incident.mode ?? null,
    severity: incident.severity,
    status: incident.status,
    summary: incident.summary,
    metrics: incident.metrics ? {
      workspace_id: incident.metrics.workspace_id,
      mode: incident.metrics.mode ?? null,
      total_events: incident.metrics.total_events,
      p50: incident.metrics.p50,
      p95: incident.metrics.p95,
      p99: incident.metrics.p99,
      rollback_rate: incident.metrics.rollback_rate
    } : null
  }));
}

test('periodic OODA worker preserves incident semantics outside the request thread', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'l99-ooda-worker-test-'));
  const dbPath = join(tempDir, 'ooda.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(schema);

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO events (workspace_id, mode, event_type, payload, duration_ms, rollback, created_at)
    VALUES ('workspace-worker', 'chapter', 'operation.completed', '{}', ?, ?, ?)
  `);
  insert.run(100, 0, now);
  insert.run(2500, 1, now + 1);

  const expected = normalizeIncidents(collectActiveIncidents(db));
  assert.equal(expected.length, 1);
  assert.equal(expected[0].source, 'runtime');

  let controller;
  try {
    const actualPromise = new Promise((resolve, reject) => {
      controller = startOodaWorkerLoop(
        dbPath,
        60_000,
        incidents => resolve(normalizeIncidents(incidents)),
        reject
      );
    });
    const actual = await actualPromise;
    assert.deepEqual(actual, expected);
  } finally {
    if (controller) await controller.stop();
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
