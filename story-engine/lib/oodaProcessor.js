// lib/oodaProcessor.js
// OODA loop: reads events table, computes p50/p95/p99 latency + rollback rate
// per workspace/mode over a rolling window.

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
    ORDER BY workspace_id, mode, duration_ms ASC
  `).all(since);

  const groups = {};
  for (const row of rows) {
    const key = `${row.workspace_id}::${row.mode ?? 'unknown'}`;
    if (!groups[key]) {
      groups[key] = {
        workspace_id: row.workspace_id,
        mode: row.mode,
        durations: [],
        rollbacks: 0,
        total: 0,
      };
    }
    groups[key].total++;
    if (row.duration_ms != null) groups[key].durations.push(row.duration_ms);
    if (row.rollback) groups[key].rollbacks++;
  }

  return Object.values(groups).map(g => {
    const sorted = [...g.durations].sort((a, b) => a - b);
    return {
      workspace_id: g.workspace_id,
      mode: g.mode,
      total_events: g.total,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      rollback_rate: g.total > 0 ? g.rollbacks / g.total : 0,
    };
  });
}

export function detectIncidents(metrics, thresholds = { p99: 1000, rollback_rate: 0.02 }) {
  return metrics
    .filter(m => m.p99 > thresholds.p99 || m.rollback_rate > thresholds.rollback_rate)
    .map(m => ({
      workspace_id: m.workspace_id,
      mode: m.mode,
      severity: m.p99 > 2000 || m.rollback_rate > 0.05 ? 'critical' : 'warning',
      summary: `p99=${m.p99}ms rollback_rate=${(m.rollback_rate * 100).toFixed(1)}%`,
      metrics: m,
    }));
}

export function startOODALoop(
  db,
  intervalMs = 30_000,
  onIncidents = (incidents) => console.log('[OODA] Incidents:', incidents)
) {
  console.log(`[OODA] Loop started — window: 15min, interval: ${intervalMs / 1000}s`);
  setInterval(() => {
    const metrics = computeMetrics(db);
    const incidents = detectIncidents(metrics);
    if (incidents.length) onIncidents(incidents);
  }, intervalMs);
}
