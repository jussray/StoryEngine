// lib/runtimeDispatcher.js

import { createHash, randomUUID } from 'node:crypto';
import * as Chapter from '../models/chapterModel.js';
import { runAutonomousRuntime } from './autonomousRuntime.js';
import { materializeAutonomousBook } from './autonomousBookProducer.js';
import { log } from '../models/eventModel.js';

export function ensureRuntimeDispatchSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_dispatch_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispatch_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      chapter_id INTEGER,
      trigger_type TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      run_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_status_created
      ON runtime_dispatch_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_dispatch_workspace
      ON runtime_dispatch_queue(workspace_id, created_at);
  `);

  const columns = db.prepare('PRAGMA table_info(runtime_dispatch_queue)').all();
  if (!columns.some(column => column.name === 'chapter_id')) {
    db.exec('ALTER TABLE runtime_dispatch_queue ADD COLUMN chapter_id INTEGER');
  }
}

const ensureSchema = ensureRuntimeDispatchSchema;

function workspaceFingerprint(db, workspaceId, chapterId = null) {
  const row = db.prepare(`
    SELECT
      s.updated_at AS story_updated,
      COALESCE(MAX(c.updated_at), 0) AS chapter_updated,
      COALESCE(ls.updated_at, 0) AS state_updated,
      COUNT(c.id) AS chapter_count
    FROM stories s
    LEFT JOIN chapters c ON c.workspace_id = s.workspace_id
    LEFT JOIN lindymode_state ls ON ls.workspace_id = s.workspace_id
    WHERE s.workspace_id = ?
    GROUP BY s.workspace_id
  `).get(workspaceId);
  if (!row) return null;
  return createHash('sha256').update(JSON.stringify({ ...row, chapter_id: chapterId })).digest('hex');
}

export function enqueueRuntime(db, workspaceId, triggerType = 'event_dispatch', chapterId = null) {
  ensureSchema(db);
  const fingerprint = workspaceFingerprint(db, workspaceId, chapterId);
  if (!fingerprint) return null;

  const duplicate = db.prepare(`
    SELECT * FROM runtime_dispatch_queue
    WHERE workspace_id = ?
      AND fingerprint = ?
      AND status IN ('queued', 'running', 'completed')
    ORDER BY created_at DESC LIMIT 1
  `).get(workspaceId, fingerprint);
  if (duplicate) return { ...duplicate, deduplicated: true };

  const dispatchId = randomUUID();
  db.prepare(`
    INSERT INTO runtime_dispatch_queue (
      dispatch_id, workspace_id, chapter_id, trigger_type,
      fingerprint, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?)
  `).run(dispatchId, workspaceId, chapterId, triggerType, fingerprint, Date.now());

  log(db, {
    workspace_id: workspaceId,
    mode: 'autonomous_runtime',
    event_type: 'runtime.dispatch.queued',
    payload: { dispatch_id: dispatchId, trigger_type: triggerType, chapter_id: chapterId, fingerprint }
  });

  return db.prepare('SELECT * FROM runtime_dispatch_queue WHERE dispatch_id = ?').get(dispatchId);
}

export function getRuntimeDispatch(db, dispatchId) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM runtime_dispatch_queue WHERE dispatch_id = ?').get(dispatchId) || null;
}

export async function processRuntimeDispatch(db, dispatchId) {
  ensureSchema(db);
  const item = getRuntimeDispatch(db, dispatchId);
  if (!item) return null;

  if (item.status !== 'queued') {
    return {
      dispatch_id: item.dispatch_id,
      status: item.status,
      run_id: item.run_id || null,
      error: item.error || null,
      skipped: true
    };
  }

  const claimed = db.prepare(`
    UPDATE runtime_dispatch_queue
    SET status = 'running', attempts = attempts + 1, started_at = ?
    WHERE dispatch_id = ? AND status = 'queued'
  `).run(Date.now(), item.dispatch_id);

  if (Number(claimed.changes || 0) !== 1) {
    const current = getRuntimeDispatch(db, item.dispatch_id);
    return current ? {
      dispatch_id: current.dispatch_id,
      status: current.status,
      run_id: current.run_id || null,
      error: current.error || null,
      skipped: true
    } : null;
  }

  try {
    let manuscript = null;
    if (item.trigger_type === 'story_engine_pipeline' || item.trigger_type === 'story_engine_operator_approved') {
      manuscript = await materializeAutonomousBook(db, {
        workspaceId: item.workspace_id,
        dispatchId: item.dispatch_id
      });
    }

    const chapter = item.chapter_id ? Chapter.get(db, Number(item.chapter_id)) : null;
    const run = runAutonomousRuntime(db, {
      workspaceId: item.workspace_id,
      chapter,
      triggerType: item.trigger_type,
      allowRecovery: true
    });
    const status = run.status === 'failed' ? 'failed' : 'completed';
    db.prepare(`
      UPDATE runtime_dispatch_queue
      SET status = ?, run_id = ?, completed_at = ?, error = NULL
      WHERE dispatch_id = ?
    `).run(status, run.run_id, Date.now(), item.dispatch_id);
    return { dispatch_id: item.dispatch_id, status, run_id: run.run_id, manuscript, run };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE runtime_dispatch_queue
      SET status = 'failed', error = ?, completed_at = ?
      WHERE dispatch_id = ?
    `).run(message, Date.now(), item.dispatch_id);
    log(db, {
      workspace_id: item.workspace_id,
      mode: 'autonomous_runtime',
      event_type: 'runtime.dispatch.failed',
      payload: { dispatch_id: item.dispatch_id, trigger_type: item.trigger_type, error: message },
      rollback: 1
    });
    return { dispatch_id: item.dispatch_id, status: 'failed', error: message };
  }
}

export async function drainRuntimeQueue(db, limit = 5) {
  ensureSchema(db);
  const queued = db.prepare(`
    SELECT dispatch_id FROM runtime_dispatch_queue
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);

  const results = [];
  for (const item of queued) {
    const result = await processRuntimeDispatch(db, item.dispatch_id);
    if (result && !result.skipped) results.push(result);
  }
  return results;
}

function assistTableExists(db) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='workspace_assist_profiles'
  `).get());
}

export function scanChangedWorkspaces(db) {
  ensureSchema(db);
  const workspaces = assistTableExists(db)
    ? db.prepare(`
        SELECT s.workspace_id
        FROM stories s
        LEFT JOIN workspace_assist_profiles ap ON ap.workspace_id=s.workspace_id
        WHERE COALESCE(ap.assist_mode, 'director') IN ('director', 'autonomous_studio', 'system_first')
        ORDER BY s.updated_at DESC
      `).all()
    : db.prepare('SELECT workspace_id FROM stories ORDER BY updated_at DESC').all();
  const enqueued = [];
  for (const { workspace_id } of workspaces) {
    const item = enqueueRuntime(db, workspace_id, 'scheduled_health_scan');
    if (item && !item.deduplicated) enqueued.push(item);
  }
  return enqueued;
}

export function listDispatchQueue(db, limit = 100) {
  ensureSchema(db);
  return db.prepare(`
    SELECT * FROM runtime_dispatch_queue
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function startRuntimeScheduler(db, {
  scanIntervalMs = 5 * 60 * 1000,
  drainIntervalMs = 15 * 1000
} = {}) {
  ensureSchema(db);
  let draining = false;
  const scan = () => {
    const queued = scanChangedWorkspaces(db);
    if (queued.length) console.log(`[Runtime] Queued ${queued.length} changed workspace(s)`);
  };
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      const results = await drainRuntimeQueue(db);
      if (results.length) console.log(`[Runtime] Processed ${results.length} dispatch item(s)`);
    } catch (error) {
      console.error('[Runtime] Queue drain failed:', error instanceof Error ? error.message : String(error));
    } finally {
      draining = false;
    }
  };
  scan();
  void drain();
  const scanTimer = setInterval(scan, scanIntervalMs);
  const drainTimer = setInterval(() => { void drain(); }, drainIntervalMs);
  return () => {
    clearInterval(scanTimer);
    clearInterval(drainTimer);
  };
}
