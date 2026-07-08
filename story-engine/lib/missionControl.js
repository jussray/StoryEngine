// lib/missionControl.js

import { collectActiveIncidents, computeMetrics } from './oodaProcessor.js';
import { listDispatchQueue } from './runtimeDispatcher.js';
import { getRetentionStatus } from './eventRetention.js';
import { evaluateReleaseGate } from './releaseGate.js';
import { latestReleaseAttempt } from './releaseAttempts.js';

function safeJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function getMissionControlSnapshot(db) {
  const stories = db.prepare(`
    SELECT
      s.workspace_id,
      s.title,
      s.updated_at,
      COUNT(DISTINCT c.id) AS chapter_count,
      COUNT(DISTINCT CASE WHEN li.status = 'active' THEN li.incident_id END) AS active_incidents
    FROM stories s
    LEFT JOIN chapters c ON c.workspace_id = s.workspace_id
    LEFT JOIN lindymode_incidents li ON li.workspace_id = s.workspace_id
    GROUP BY s.workspace_id
    ORDER BY s.updated_at DESC
  `).all();

  const latestRuns = db.prepare(`
    SELECT r.*
    FROM autonomous_runtime_runs r
    JOIN (
      SELECT workspace_id, MAX(created_at) AS latest
      FROM autonomous_runtime_runs
      GROUP BY workspace_id
    ) x ON x.workspace_id = r.workspace_id AND x.latest = r.created_at
  `).all();
  const runsByWorkspace = new Map(latestRuns.map(row => [row.workspace_id, row]));

  const latestRisks = db.prepare(`
    SELECT r.*
    FROM ooda_risk_snapshots r
    JOIN (
      SELECT workspace_id, MAX(created_at) AS latest
      FROM ooda_risk_snapshots
      GROUP BY workspace_id
    ) x ON x.workspace_id = r.workspace_id AND x.latest = r.created_at
  `).all();
  const risksByWorkspace = new Map(latestRisks.map(row => [row.workspace_id, row]));

  const recoveryStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) AS validated,
      SUM(CASE WHEN status = 'rolled_back' THEN 1 ELSE 0 END) AS rolled_back,
      SUM(CASE WHEN status = 'awaiting_author' THEN 1 ELSE 0 END) AS awaiting_author
    FROM ooda_recovery_runs
  `).get();

  const runtimeStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM autonomous_runtime_runs
  `).get();

  const attemptStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
    FROM release_attempts
  `).get();

  const metrics = computeMetrics(db);
  const incidents = collectActiveIncidents(db);
  const queue = listDispatchQueue(db, 100);
  const retention = getRetentionStatus(db);

  const workspaces = stories.map(story => {
    const run = runsByWorkspace.get(story.workspace_id);
    const risk = risksByWorkspace.get(story.workspace_id);
    const runResult = safeJson(run?.result_json, {});
    const gate = evaluateReleaseGate(db, story.workspace_id);
    const attempt = latestReleaseAttempt(db, story.workspace_id);
    return {
      workspace_id: story.workspace_id,
      title: story.title,
      chapter_count: Number(story.chapter_count || 0),
      active_incidents: Number(story.active_incidents || 0),
      updated_at: story.updated_at,
      runtime_status: run?.status || 'never_run',
      runtime_run_id: run?.run_id || null,
      release_gate_status: gate?.status || 'UNKNOWN',
      release_gate_reasons: gate?.reasons || [],
      confidence_score: Number(gate?.confidence || runResult.decision?.confidence_score || 0),
      predicted_risk: risk?.predicted_risk || runResult.prediction?.predicted_risk || 'UNKNOWN',
      latest_release_attempt: attempt ? {
        attempt_id: attempt.attempt_id,
        operation: attempt.operation,
        status: attempt.status,
        gate_status: attempt.gate_status,
        created_at: attempt.created_at,
        completed_at: attempt.completed_at,
        error: attempt.error
      } : null
    };
  });

  const validated = Number(recoveryStats?.validated || 0);
  const recoveryTotal = Number(recoveryStats?.total || 0);
  const gateCounts = workspaces.reduce((acc, item) => {
    acc[item.release_gate_status] = (acc[item.release_gate_status] || 0) + 1;
    return acc;
  }, {});

  return {
    generated_at: Date.now(),
    overview: {
      workspaces: workspaces.length,
      active_incidents: incidents.length,
      queue_depth: queue.filter(item => item.status === 'queued').length,
      running_dispatches: queue.filter(item => item.status === 'running').length,
      runtime_runs: Number(runtimeStats?.total || 0),
      runtime_failures: Number(runtimeStats?.failed || 0),
      recovery_success_rate: recoveryTotal ? validated / recoveryTotal : null,
      live_event_count: retention.live_event_count,
      compacted_episode_count: retention.compacted_episode_count,
      release_gate_ready: gateCounts.READY || 0,
      release_gate_warning: gateCounts.WARNING || 0,
      release_gate_blocked_count: gateCounts.BLOCKED || 0,
      release_attempts_total: Number(attemptStats?.total || 0),
      release_attempts_running: Number(attemptStats?.running || 0),
      release_attempts_blocked: Number(attemptStats?.blocked || 0),
      release_attempts_failed: Number(attemptStats?.failed || 0)
    },
    workspaces,
    incidents,
    metrics,
    queue: queue.slice(0, 25),
    retention,
    release_attempts: {
      total: Number(attemptStats?.total || 0),
      completed: Number(attemptStats?.completed || 0),
      blocked: Number(attemptStats?.blocked || 0),
      failed: Number(attemptStats?.failed || 0),
      running: Number(attemptStats?.running || 0)
    },
    recovery: {
      total: recoveryTotal,
      validated,
      rolled_back: Number(recoveryStats?.rolled_back || 0),
      awaiting_author: Number(recoveryStats?.awaiting_author || 0)
    }
  };
}
