import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runEventRetention } from '../lib/eventRetention.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function insertEvent(db, workspaceId, payload, createdAt, eventType = 'runtime.step') {
  db.prepare(`
    INSERT INTO events (
      workspace_id, mode, event_type, payload, duration_ms, rollback, created_at
    ) VALUES (?, 'ooda', ?, ?, 10, 0, ?)
  `).run(workspaceId, eventType, JSON.stringify(payload), createdAt);
}

test('retention compacts camelCase correlationId payloads', () => {
  const db = createDb();
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;

  insertEvent(db, 'workspace-camel', { correlationId: 'corr-camel' }, old, 'runtime.start');
  insertEvent(db, 'workspace-camel', { correlationId: 'corr-camel' }, old + 1, 'runtime.complete');

  const result = runEventRetention(db, {
    keepMs: 7 * 24 * 60 * 60 * 1000,
    limit: 10
  });

  const remaining = db.prepare('SELECT COUNT(*) AS count FROM events').get();
  const compacted = db.prepare(`
    SELECT * FROM compacted_event_episodes WHERE correlation_id = 'corr-camel'
  `).get();

  assert.equal(result.compacted_groups, 1);
  assert.equal(result.deleted_events, 2);
  assert.equal(Number(remaining.count), 0);
  assert.equal(compacted.event_count, 2);
  db.close();
});

test('retention skips a correlation when any event is newer than cutoff', () => {
  const db = createDb();
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const recent = Date.now() - 60 * 60 * 1000;

  insertEvent(db, 'workspace-partial', { correlation_id: 'corr-partial' }, old, 'runtime.start');
  insertEvent(db, 'workspace-partial', { correlation_id: 'corr-partial' }, recent, 'runtime.complete');

  const result = runEventRetention(db, {
    keepMs: 7 * 24 * 60 * 60 * 1000,
    limit: 10
  });

  const remaining = db.prepare('SELECT COUNT(*) AS count FROM events').get();
  const compacted = db.prepare(`
    SELECT COUNT(*) AS count FROM compacted_event_episodes
    WHERE correlation_id = 'corr-partial'
  `).get();

  assert.equal(result.compacted_groups, 0);
  assert.equal(result.skipped_groups, 1);
  assert.equal(result.deleted_events, 0);
  assert.equal(Number(remaining.count), 2);
  assert.equal(Number(compacted.count), 0);
  db.close();
});

test('retention protects running runtime correlations', () => {
  const db = createDb();
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;

  insertEvent(db, 'workspace-running', { correlation_id: 'corr-running' }, old);
  db.prepare(`
    INSERT INTO autonomous_runtime_runs (
      run_id, correlation_id, workspace_id, trigger_type, status,
      steps_json, result_json, created_at
    ) VALUES (
      'run-running', 'corr-running', 'workspace-running', 'test', 'running',
      '[]', '{}', ?
    )
  `).run(old);

  const result = runEventRetention(db, {
    keepMs: 7 * 24 * 60 * 60 * 1000,
    limit: 10
  });

  assert.equal(result.compacted_groups, 0);
  assert.equal(result.skipped_groups, 1);
  assert.equal(result.deleted_events, 0);
  db.close();
});

test('retention rejects unsafe keep windows', () => {
  const db = createDb();

  assert.throws(
    () => runEventRetention(db, { keepMs: 60 * 60 * 1000 }),
    /at least 24 hours/
  );

  assert.throws(
    () => runEventRetention(db, { keepMs: Number.NaN }),
    /finite number/
  );

  db.close();
});

test('retention dry run previews without deleting', () => {
  const db = createDb();
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  insertEvent(db, 'workspace-preview', { correlation_id: 'corr-preview' }, old);

  const result = runEventRetention(db, {
    keepMs: 7 * 24 * 60 * 60 * 1000,
    limit: 10,
    dryRun: true
  });
  const remaining = db.prepare('SELECT COUNT(*) AS count FROM events').get();

  assert.equal(result.status, 'dry_run');
  assert.equal(result.candidate_groups, 1);
  assert.equal(result.compacted_groups, 1);
  assert.equal(result.deleted_events, 0);
  assert.equal(Number(remaining.count), 1);
  db.close();
});
