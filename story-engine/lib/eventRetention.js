// lib/eventRetention.js

import { randomUUID } from 'node:crypto';

const DEFAULT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function safeJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_compaction_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compaction_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      cutoff_at INTEGER NOT NULL,
      keep_ms INTEGER NOT NULL,
      compacted_groups INTEGER NOT NULL DEFAULT 0,
      deleted_events INTEGER NOT NULL DEFAULT 0,
      skipped_groups INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS compacted_event_episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compaction_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      first_event_at INTEGER NOT NULL,
      last_event_at INTEGER NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      UNIQUE(correlation_id, first_event_at, last_event_at)
    );
    CREATE INDEX IF NOT EXISTS idx_compacted_events_correlation ON compacted_event_episodes(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_compaction_runs_created ON event_compaction_runs(created_at);
  `);
}

function extractCorrelationId(event) {
  const payload = safeJson(event.payload, null);
  if (payload?.correlation_id) return payload.correlation_id;
  if (payload?.correlationId) return payload.correlationId;
  return null;
}

function summarizeEvents(correlationId, events) {
  const eventTypes = {};
  const modes = {};
  let rollbackCount = 0;
  let durationTotal = 0;
  let durationCount = 0;

  for (const event of events) {
    eventTypes[event.event_type] = (eventTypes[event.event_type] || 0) + 1;
    modes[event.mode || 'application'] = (modes[event.mode || 'application'] || 0) + 1;
    if (event.rollback) rollbackCount += 1;
    if (event.duration_ms != null) {
      durationTotal += Number(event.duration_ms || 0);
      durationCount += 1;
    }
  }

  return {
    correlation_id: correlationId,
    event_count: events.length,
    event_types: eventTypes,
    modes,
    rollback_count: rollbackCount,
    first_event_type: events[0]?.event_type || null,
    last_event_type: events.at(-1)?.event_type || null,
    average_duration_ms: durationCount ? Math.round(durationTotal / durationCount) : null,
    event_ids: events.map(event => event.id)
  };
}

function hasActiveIncident(db, correlationId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM lindymode_incidents
    WHERE correlation_id = ? AND status = 'active'
  `).get(correlationId);
  return Number(row?.count || 0) > 0;
}

function loadEligibleGroups(db, cutoffAt, limit) {
  const rows = db.prepare(`
    SELECT * FROM events
    WHERE created_at < ?
      AND payload LIKE '%correlation_id%'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(cutoffAt, limit * 50);

  const groups = new Map();
  for (const row of rows) {
    const correlationId = extractCorrelationId(row);
    if (!correlationId) continue;
    if (!groups.has(correlationId)) groups.set(correlationId, []);
    groups.get(correlationId).push(row);
  }

  return [...groups.entries()].slice(0, limit).map(([correlationId, events]) => ({ correlationId, events }));
}

export function getRetentionStatus(db, keepMs = DEFAULT_KEEP_MS) {
  ensureTables(db);
  const now = Date.now();
  const cutoffAt = now - keepMs;
  const live = db.prepare(`
    SELECT COUNT(*) AS count, MIN(created_at) AS oldest, MAX(created_at) AS newest
    FROM events
  `).get();
  const eligible = db.prepare(`
    SELECT COUNT(*) AS count
    FROM events
    WHERE created_at < ? AND payload LIKE '%correlation_id%'
  `).get(cutoffAt);
  const compacted = db.prepare(`
    SELECT COUNT(*) AS count, MAX(created_at) AS last_compacted
    FROM compacted_event_episodes
  `).get();
  const lastRun = db.prepare(`
    SELECT * FROM event_compaction_runs
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  return {
    keep_ms: keepMs,
    cutoff_at: cutoffAt,
    live_event_count: Number(live?.count || 0),
    oldest_live_event_at: live?.oldest || null,
    newest_live_event_at: live?.newest || null,
    eligible_event_count: Number(eligible?.count || 0),
    compacted_episode_count: Number(compacted?.count || 0),
    last_compacted_at: compacted?.last_compacted || null,
    last_run: lastRun || null
  };
}

export function runEventRetention(db, {
  keepMs = DEFAULT_KEEP_MS,
  limit = 100,
  dryRun = false
} = {}) {
  ensureTables(db);
  const compactionId = randomUUID();
  const cutoffAt = Date.now() - keepMs;
  const startedAt = Date.now();

  db.prepare(`
    INSERT INTO event_compaction_runs (
      compaction_id, status, cutoff_at, keep_ms, created_at
    ) VALUES (?, 'running', ?, ?, ?)
  `).run(compactionId, cutoffAt, keepMs, startedAt);

  let compactedGroups = 0;
  let deletedEvents = 0;
  let skippedGroups = 0;

  try {
    const groups = loadEligibleGroups(db, cutoffAt, limit);

    const compactOne = db.transaction((group) => {
      const { correlationId, events } = group;
      if (hasActiveIncident(db, correlationId)) {
        skippedGroups += 1;
        return;
      }

      const summary = summarizeEvents(correlationId, events);
      const workspaceId = events[0].workspace_id;
      const firstEventAt = events[0].created_at;
      const lastEventAt = events.at(-1).created_at;

      if (!dryRun) {
        db.prepare(`
          INSERT OR IGNORE INTO compacted_event_episodes (
            compaction_id, correlation_id, workspace_id, event_count,
            first_event_at, last_event_at, summary_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          compactionId,
          correlationId,
          workspaceId,
          events.length,
          firstEventAt,
          lastEventAt,
          JSON.stringify(summary),
          Date.now()
        );

        const ids = events.map(event => event.id);
        const placeholders = ids.map(() => '?').join(',');
        const result = db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids);
        deletedEvents += Number(result.changes || 0);
      }

      compactedGroups += 1;
    });

    for (const group of groups) compactOne(group);

    db.prepare(`
      UPDATE event_compaction_runs
      SET status = ?, compacted_groups = ?, deleted_events = ?, skipped_groups = ?, completed_at = ?
      WHERE compaction_id = ?
    `).run(dryRun ? 'dry_run' : 'completed', compactedGroups, deletedEvents, skippedGroups, Date.now(), compactionId);

    return {
      compaction_id: compactionId,
      status: dryRun ? 'dry_run' : 'completed',
      cutoff_at: cutoffAt,
      keep_ms: keepMs,
      compacted_groups: compactedGroups,
      deleted_events: deletedEvents,
      skipped_groups: skippedGroups
    };
  } catch (error) {
    db.prepare(`
      UPDATE event_compaction_runs
      SET status = 'failed', error = ?, completed_at = ?
      WHERE compaction_id = ?
    `).run(error.message, Date.now(), compactionId);
    throw error;
  }
}
