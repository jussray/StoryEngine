// lib/oodaProcessor.js
// OODA loop: combines application runtime metrics, Lindymode incidents, and Story Memory drift.

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeMetrics(db, windowMs = 15 * 60 * 1000) {
  const since = Date.now() - windowMs;
  const rows = db.prepare(`
    SELECT workspace_id, mode, event_type, duration_ms, rollback
    FROM events
    WHERE created_at >= ?
      AND COALESCE(mode, '') NOT IN ('ooda', 'autonomous_runtime')
      AND event_type NOT LIKE 'runtime.%'
      AND event_type NOT LIKE 'release.%'
    ORDER BY workspace_id, mode, duration_ms ASC
  `).all(since);

  const groups = {};
  for (const row of rows) {
    const key = `${row.workspace_id}::${row.mode ?? 'application'}`;
    if (!groups[key]) {
      groups[key] = {
        workspace_id: row.workspace_id,
        mode: row.mode,
        durations: [],
        rollbacks: 0,
        total: 0
      };
    }
    groups[key].total++;
    if (row.duration_ms != null) groups[key].durations.push(row.duration_ms);
    if (row.rollback) groups[key].rollbacks++;
  }

  return Object.values(groups).map(group => {
    const sorted = [...group.durations].sort((a, b) => a - b);
    return {
      workspace_id: group.workspace_id,
      mode: group.mode,
      total_events: group.total,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      rollback_rate: group.total > 0 ? group.rollbacks / group.total : 0
    };
  });
}

export function detectMetricIncidents(metrics, thresholds = { p99: 1000, rollback_rate: 0.02 }) {
  return metrics
    .filter(metric => metric.p99 > thresholds.p99 || metric.rollback_rate > thresholds.rollback_rate)
    .map(metric => ({
      incident_id: `ooda_metric:${metric.workspace_id}:${metric.mode || 'application'}`,
      correlation_id: null,
      source: 'runtime',
      workspace_id: metric.workspace_id,
      mode: metric.mode,
      severity: metric.p99 > 2000 || metric.rollback_rate > 0.05 ? 'critical' : 'warning',
      summary: `p99=${metric.p99}ms rollback_rate=${(metric.rollback_rate * 100).toFixed(1)}%`,
      status: 'active',
      created_at: Date.now(),
      metrics: metric
    }));
}

export function getLindymodeIncidents(db, limit = 200) {
  return db.prepare(`
    SELECT
      incident_id, correlation_id, parent_event_id, workspace_id, chapter_id,
      event_type, severity, status, reason, drift_score, details_json,
      recovery_action, created_at, resolved_at
    FROM lindymode_incidents
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map(row => ({
    incident_id: row.incident_id,
    correlation_id: row.correlation_id,
    parent_event_id: row.parent_event_id,
    source: 'lindymode',
    workspace_id: row.workspace_id,
    chapter_id: row.chapter_id,
    mode: 'lindymode',
    event_type: row.event_type,
    severity: row.severity === 'sev3' ? 'critical' : row.severity === 'sev2' ? 'warning' : 'watch',
    summary: row.reason,
    status: row.status,
    drift_score: row.drift_score,
    details: JSON.parse(row.details_json || '{}'),
    recovery_action: row.recovery_action,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    metrics: null
  }));
}

export function getGenomeDriftIncidents(db, limit = 200) {
  return db.prepare(`
    SELECT id, diff_id, workspace_id, chapter_id, entity_type, entity_id,
           field, old_value, new_value, source, created_at
    FROM memory_diffs
    WHERE conflict = 1 AND resolved = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map(row => ({
    incident_id: `genome_drift:${row.diff_id || row.id}`,
    correlation_id: row.diff_id || null,
    parent_event_id: null,
    source: 'story_memory',
    workspace_id: row.workspace_id,
    chapter_id: row.chapter_id,
    mode: 'memory',
    event_type: 'GENOME_DRIFT',
    severity: 'critical',
    summary: `${row.entity_type}:${row.entity_id} ${row.field} conflicts (${row.old_value ?? 'unknown'} → ${row.new_value ?? 'unknown'}).`,
    status: 'active',
    drift_score: 1,
    details: {
      diff_id: row.diff_id || row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      field: row.field,
      old_value: row.old_value,
      new_value: row.new_value,
      source: row.source
    },
    recovery_action: null,
    created_at: row.created_at,
    resolved_at: null,
    metrics: null
  }));
}

export function collectActiveIncidents(db, thresholds) {
  const metricIncidents = detectMetricIncidents(computeMetrics(db), thresholds);
  const lindymodeIncidents = getLindymodeIncidents(db);
  const genomeIncidents = getGenomeDriftIncidents(db);
  return [...genomeIncidents, ...lindymodeIncidents, ...metricIncidents].sort((a, b) => {
    const rank = { critical: 3, warning: 2, watch: 1 };
    const severityDelta = (rank[b.severity] || 0) - (rank[a.severity] || 0);
    return severityDelta || Number(b.created_at || 0) - Number(a.created_at || 0);
  });
}

export function startOODALoop(
  db,
  intervalMs = 30_000,
  onIncidents = incidents => console.log('[OODA] Incidents:', incidents)
) {
  console.log(`[OODA] Loop started — window: 15min, interval: ${intervalMs / 1000}s`);
  const run = () => onIncidents(collectActiveIncidents(db));
  run();
  return setInterval(run, intervalMs);
}
