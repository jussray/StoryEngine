// lib/learningEngine.js

import { randomUUID } from 'node:crypto';
import { evaluateWorkspace } from './decisionEngine.js';
import { log } from '../models/eventModel.js';

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function captureEpisodeFromIncident(db, incidentId, outcome = 'unknown') {
  const incident = db.prepare(`
    SELECT * FROM lindymode_incidents WHERE incident_id = ?
  `).get(incidentId);
  if (!incident) return null;

  const existing = db.prepare(`
    SELECT * FROM ooda_episodes WHERE correlation_id = ? AND trigger_type = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(incident.correlation_id, incident.event_type);
  if (existing) return existing;

  const before = db.prepare(`
    SELECT confidence_score FROM ooda_decisions
    WHERE workspace_id = ? AND created_at <= ?
    ORDER BY created_at DESC LIMIT 1
  `).get(incident.workspace_id, incident.created_at);

  const afterDecision = evaluateWorkspace(db, incident.workspace_id);
  const episodeId = randomUUID();
  const completedAt = incident.status === 'resolved' ? incident.resolved_at || Date.now() : null;

  db.prepare(`
    INSERT INTO ooda_episodes (
      episode_id, workspace_id, correlation_id, trigger_type, severity,
      recovery_action, outcome, confidence_before, confidence_after,
      evidence_json, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    episodeId,
    incident.workspace_id,
    incident.correlation_id,
    incident.event_type,
    incident.severity,
    incident.recovery_action,
    outcome,
    before?.confidence_score ?? null,
    afterDecision.confidence_score,
    JSON.stringify({
      chapter_id: incident.chapter_id,
      drift_score: incident.drift_score,
      reason: incident.reason,
      details: safeJson(incident.details_json, {})
    }),
    incident.created_at,
    completedAt
  );

  log(db, {
    workspace_id: incident.workspace_id,
    mode: 'ooda',
    event_type: 'ooda.episode_captured',
    payload: {
      episode_id: episodeId,
      correlation_id: incident.correlation_id,
      trigger_type: incident.event_type,
      outcome
    }
  });

  return db.prepare('SELECT * FROM ooda_episodes WHERE episode_id = ?').get(episodeId);
}

export function completeEpisode(db, episodeId, outcome, confidenceAfter = null) {
  const episode = db.prepare('SELECT * FROM ooda_episodes WHERE episode_id = ?').get(episodeId);
  if (!episode) return null;

  const after = confidenceAfter ?? evaluateWorkspace(db, episode.workspace_id).confidence_score;
  db.prepare(`
    UPDATE ooda_episodes
    SET outcome = ?, confidence_after = ?, completed_at = ?
    WHERE episode_id = ?
  `).run(outcome, after, Date.now(), episodeId);

  log(db, {
    workspace_id: episode.workspace_id,
    mode: 'ooda',
    event_type: 'ooda.episode_completed',
    payload: { episode_id: episodeId, outcome, confidence_after: after }
  });

  return db.prepare('SELECT * FROM ooda_episodes WHERE episode_id = ?').get(episodeId);
}

export function learnedRecoveries(db, triggerType = null, limit = 20) {
  const rows = triggerType
    ? db.prepare(`
        SELECT trigger_type, recovery_action, outcome,
               COUNT(*) AS uses,
               AVG(COALESCE(confidence_after, 0) - COALESCE(confidence_before, 0)) AS avg_gain
        FROM ooda_episodes
        WHERE trigger_type = ? AND recovery_action IS NOT NULL
        GROUP BY trigger_type, recovery_action, outcome
        ORDER BY uses DESC, avg_gain DESC
        LIMIT ?
      `).all(triggerType, limit)
    : db.prepare(`
        SELECT trigger_type, recovery_action, outcome,
               COUNT(*) AS uses,
               AVG(COALESCE(confidence_after, 0) - COALESCE(confidence_before, 0)) AS avg_gain
        FROM ooda_episodes
        WHERE recovery_action IS NOT NULL
        GROUP BY trigger_type, recovery_action, outcome
        ORDER BY uses DESC, avg_gain DESC
        LIMIT ?
      `).all(limit);

  return rows.map(row => ({
    ...row,
    uses: Number(row.uses || 0),
    avg_gain: Number(Number(row.avg_gain || 0).toFixed(2)),
    success_rate: row.outcome === 'success' ? 1 : row.outcome === 'partial' ? 0.5 : 0
  }));
}

function trend(values) {
  if (values.length < 2) return 0;
  return values[values.length - 1] - values[0];
}

export function predictWorkspaceRisk(db, workspaceId) {
  const current = evaluateWorkspace(db, workspaceId);
  const history = db.prepare(`
    SELECT confidence_score, created_at
    FROM ooda_decisions
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 6
  `).all(workspaceId).reverse();

  const confidenceTrend = trend(history.map(row => Number(row.confidence_score || 0)));
  const incidentRows = db.prepare(`
    SELECT drift_score, severity, created_at
    FROM lindymode_incidents
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 12
  `).all(workspaceId).reverse();
  const driftTrend = trend(incidentRows.map(row => Number(row.drift_score || 0)));

  let risk = 'LOW';
  const signals = [];

  if (current.confidence_score < 55) {
    risk = 'CRITICAL';
    signals.push('Current confidence is below 55.');
  } else if (current.confidence_score < 75) {
    risk = 'HIGH';
    signals.push('Current confidence is below 75.');
  }

  if (confidenceTrend <= -20) {
    risk = 'CRITICAL';
    signals.push(`Confidence declined ${Math.abs(confidenceTrend)} points across recent decisions.`);
  } else if (confidenceTrend <= -10 && risk !== 'CRITICAL') {
    risk = 'HIGH';
    signals.push(`Confidence declined ${Math.abs(confidenceTrend)} points across recent decisions.`);
  } else if (confidenceTrend < 0 && risk === 'LOW') {
    risk = 'MEDIUM';
    signals.push('Confidence is trending downward.');
  }

  if (driftTrend >= 0.35) {
    risk = risk === 'CRITICAL' ? risk : 'HIGH';
    signals.push('Narrative drift is rising sharply.');
  } else if (driftTrend > 0.1 && risk === 'LOW') {
    risk = 'MEDIUM';
    signals.push('Narrative drift is rising.');
  }

  if (current.evidence.runtime.p99 > 1800) {
    risk = risk === 'CRITICAL' ? risk : 'HIGH';
    signals.push('Runtime p99 is approaching the hard block threshold.');
  }

  if (!signals.length) signals.push('No material upward risk trend detected.');

  const learned = learnedRecoveries(db, null, 50)
    .filter(item => current.reasons.some(reason => item.trigger_type.includes(reason.code) || reason.code.includes(item.trigger_type)))
    .slice(0, 3);

  const prediction = {
    workspace_id: workspaceId,
    predicted_risk: risk,
    confidence_score: current.confidence_score,
    confidence_trend: confidenceTrend,
    drift_trend: Number(driftTrend.toFixed(3)),
    signals,
    likely_next_action: risk === 'CRITICAL' ? 'BLOCK' : risk === 'HIGH' ? 'RECOVER' : risk === 'MEDIUM' ? 'INTERVENE' : 'WATCH',
    learned_recoveries: learned,
    generated_at: Date.now()
  };

  const snapshotId = randomUUID();
  db.prepare(`
    INSERT INTO ooda_risk_snapshots (
      snapshot_id, workspace_id, confidence_score, drift_score,
      p99, rollback_rate, predicted_risk, prediction_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId,
    workspaceId,
    current.confidence_score,
    current.evidence.max_drift,
    current.evidence.runtime.p99,
    current.evidence.runtime.rollback_rate,
    risk,
    JSON.stringify(prediction),
    Date.now()
  );

  log(db, {
    workspace_id: workspaceId,
    mode: 'ooda',
    event_type: 'ooda.risk_predicted',
    payload: { snapshot_id: snapshotId, predicted_risk: risk, confidence_trend: confidenceTrend, drift_trend: driftTrend },
    rollback: risk === 'CRITICAL' ? 1 : 0
  });

  return { ...prediction, snapshot_id: snapshotId };
}

export function listEpisodes(db, workspaceId, limit = 100) {
  return db.prepare(`
    SELECT * FROM ooda_episodes
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit).map(row => ({
    ...row,
    evidence: safeJson(row.evidence_json, {})
  }));
}
