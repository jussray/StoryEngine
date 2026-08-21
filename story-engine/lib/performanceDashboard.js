// lib/performanceDashboard.js

import { computeMetrics, collectActiveIncidents } from './oodaProcessor.js';
import { evaluateReleaseGate } from './releaseGate.js';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function boundedWindowMs(value) {
  const number = Number(value || 15 * 60 * 1000);
  if (!Number.isFinite(number)) return 15 * 60 * 1000;
  return Math.max(60 * 1000, Math.min(Math.floor(number), 24 * 60 * 60 * 1000));
}

function boundedLimit(value) {
  const number = Number(value || 100);
  if (!Number.isFinite(number)) return 100;
  return Math.max(1, Math.min(Math.floor(number), 500));
}

function computeWorkspaceSummary(db, windowMs) {
  const since = Date.now() - windowMs;
  const rows = db.prepare(`
    SELECT workspace_id, duration_ms, rollback, event_type, mode, created_at
    FROM events
    WHERE created_at >= ?
    ORDER BY workspace_id, created_at DESC
  `).all(since);

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.workspace_id)) {
      groups.set(row.workspace_id, {
        workspace_id: row.workspace_id,
        durations: [],
        rollback_count: 0,
        total_events: 0,
        error_count: 0,
        latest_event_at: null
      });
    }
    const group = groups.get(row.workspace_id);
    group.total_events += 1;
    if (row.duration_ms != null) group.durations.push(Number(row.duration_ms));
    if (row.rollback) group.rollback_count += 1;
    if (/error|failed|blocked/i.test(row.event_type || '')) group.error_count += 1;
    group.latest_event_at = Math.max(Number(group.latest_event_at || 0), Number(row.created_at || 0));
  }

  const stories = db.prepare('SELECT workspace_id, title FROM stories').all();
  const titles = new Map(stories.map(item => [item.workspace_id, item.title]));

  return [...groups.values()].map(group => {
    const sorted = [...group.durations].sort((a, b) => a - b);
    const latencySampleCount = sorted.length;
    const p50 = percentile(sorted, 50);
    const p99 = percentile(sorted, 99);
    const rollbackRate = group.total_events ? group.rollback_count / group.total_events : 0;
    const errorRate = group.total_events ? group.error_count / group.total_events : 0;
    const status = rollbackRate > 0.05 || errorRate > 0.1 || (latencySampleCount > 0 && p99 > 2000)
      ? 'critical'
      : rollbackRate > 0.02 || errorRate > 0.05 || (latencySampleCount > 0 && p99 > 1000)
        ? 'warning'
        : latencySampleCount === 0 ? 'unknown' : 'healthy';
    return {
      workspace_id: group.workspace_id,
      title: titles.get(group.workspace_id) || group.workspace_id,
      total_events: group.total_events,
      latency_sample_count: latencySampleCount,
      p50,
      p99,
      p99_ratio: p50 ? Number((p99 / p50).toFixed(2)) : 0,
      rollback_rate: rollbackRate,
      error_rate: errorRate,
      status,
      latest_event_at: group.latest_event_at
    };
  }).sort((a, b) => {
    const rank = { critical: 4, warning: 3, unknown: 2, healthy: 1 };
    return (rank[b.status] || 0) - (rank[a.status] || 0) || b.p99 - a.p99;
  });
}

function latestEvents(db, limit) {
  return db.prepare(`
    SELECT id, workspace_id, mode, event_type, duration_ms, rollback, created_at
    FROM events
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

function gatePressure(db) {
  const workspaces = db.prepare('SELECT workspace_id FROM stories ORDER BY updated_at DESC').all();
  const rows = workspaces.map(({ workspace_id }) => evaluateReleaseGate(db, workspace_id)).filter(Boolean);
  return {
    ready: rows.filter(item => item.status === 'READY').length,
    warning: rows.filter(item => item.status === 'WARNING').length,
    blocked: rows.filter(item => item.status === 'BLOCKED').length,
    gates: rows.map(item => ({
      workspace_id: item.workspace_id,
      status: item.status,
      confidence: item.confidence,
      blockers: item.blockers,
      warnings: item.warnings,
      metrics: item.metrics
    }))
  };
}

export function buildPerformanceDashboard(db, options = {}) {
  const windowMs = boundedWindowMs(options.windowMs);
  const limit = boundedLimit(options.limit);
  const metrics = computeMetrics(db, windowMs);
  const workspaces = computeWorkspaceSummary(db, windowMs);
  const incidents = collectActiveIncidents(db);
  const gates = gatePressure(db);

  const totals = workspaces.reduce((acc, item) => {
    acc.events += item.total_events;
    acc.latency_samples += item.latency_sample_count;
    acc.rollback_count += Math.round(item.rollback_rate * item.total_events);
    acc.error_count += Math.round(item.error_rate * item.total_events);
    if (item.latency_sample_count > 0) acc.p99_max = Math.max(acc.p99_max, item.p99);
    return acc;
  }, { events: 0, latency_samples: 0, rollback_count: 0, error_count: 0, p99_max: 0 });

  return {
    generated_at: Date.now(),
    window_ms: windowMs,
    overview: {
      workspaces: workspaces.length,
      total_events: totals.events,
      latency_samples: totals.latency_samples,
      max_p99: totals.latency_samples ? totals.p99_max : null,
      rollback_rate: totals.events ? totals.rollback_count / totals.events : 0,
      error_rate: totals.events ? totals.error_count / totals.events : 0,
      active_incidents: incidents.length,
      gate_ready: gates.ready,
      gate_warning: gates.warning,
      gate_blocked: gates.blocked
    },
    workspace_metrics: workspaces,
    endpoint_metrics: metrics,
    gate_pressure: gates,
    incidents: incidents.slice(0, 25),
    recent_events: latestEvents(db, limit)
  };
}
