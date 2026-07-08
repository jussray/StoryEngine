// lib/releaseGate.js

import { randomUUID } from 'node:crypto';
import { evaluateWorkspace } from './decisionEngine.js';
import { log } from '../models/eventModel.js';

const SUPPORTED_SCHEMA_VERSIONS = new Set(['1.0.0']);

function safeJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function latestRuntime(db, workspaceId) {
  const row = db.prepare(`
    SELECT * FROM autonomous_runtime_runs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(workspaceId);
  return row ? { ...row, result: safeJson(row.result_json, {}) } : null;
}

function latestRecovery(db, workspaceId) {
  const row = db.prepare(`
    SELECT * FROM ooda_recovery_runs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(workspaceId);
  return row || null;
}

function activeIncidents(db, workspaceId) {
  return db.prepare(`
    SELECT * FROM lindymode_incidents
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(workspaceId);
}

function rollbackLoopDetected(db, workspaceId) {
  const rows = db.prepare(`
    SELECT status
    FROM ooda_recovery_runs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 3
  `).all(workspaceId);
  return rows.length >= 3 && rows.every(row => row.status === 'rolled_back');
}

function failedMigrationDetected(db, workspaceId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM events
    WHERE workspace_id = ?
      AND event_type IN ('migration.failed', 'schema.migration_failed')
      AND created_at >= ?
  `).get(workspaceId, Date.now() - 24 * 60 * 60 * 1000);
  return Number(row?.count || 0) > 0;
}

export function evaluateReleaseGate(db, workspaceId, options = {}) {
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspaceId);
  if (!story) return null;

  const decision = evaluateWorkspace(db, workspaceId);
  const runtime = latestRuntime(db, workspaceId);
  const recovery = latestRecovery(db, workspaceId);
  const incidents = activeIncidents(db, workspaceId);
  const blockers = [];
  const warnings = [];
  const actions = [];

  const sev3 = incidents.filter(item => item.severity === 'sev3');
  const continuity = incidents.filter(item => item.event_type === 'lindymode.continuity_conflict');
  const rollbackLoop = rollbackLoopDetected(db, workspaceId);
  const migrationFailed = failedMigrationDetected(db, workspaceId);
  const supportedSchema = SUPPORTED_SCHEMA_VERSIONS.has(story.schema_version || '1.0.0');

  if (sev3.length) blockers.push(`${sev3.length} active Sev3 incident(s).`);
  if (continuity.length) blockers.push(`${continuity.length} unresolved continuity conflict(s).`);
  if (runtime?.status === 'failed') blockers.push('Latest autonomous runtime failed.');
  if (!supportedSchema) blockers.push(`Unsupported schema version: ${story.schema_version}.`);
  if (migrationFailed) blockers.push('A schema migration failed within the last 24 hours.');
  if (rollbackLoop) blockers.push('Rollback loop detected in the three latest recovery attempts.');

  const confidenceThreshold = Number(options.confidenceThreshold || 75);
  const p99Limit = Number(options.p99Limit || 2000);
  if (decision.confidence_score < confidenceThreshold) {
    warnings.push(`Confidence ${decision.confidence_score}% is below ${confidenceThreshold}%.`);
  }
  if (decision.evidence.max_drift >= 0.5) warnings.push(`High drift score: ${decision.evidence.max_drift}.`);
  if (decision.evidence.runtime.p99 > p99Limit) warnings.push(`Runtime p99 ${decision.evidence.runtime.p99}ms exceeds ${p99Limit}ms.`);
  if (recovery && ['planned', 'awaiting_author'].includes(recovery.status)) {
    warnings.push(`Recovery validation is pending: ${recovery.status}.`);
  }

  if (sev3.length || continuity.length) actions.push('Resolve active Lindymode incidents and re-run the autonomous runtime.');
  if (runtime?.status === 'failed') actions.push('Open the runtime ledger, fix the failed step, and run again.');
  if (!supportedSchema || migrationFailed) actions.push('Repair or migrate the workspace schema before release.');
  if (rollbackLoop) actions.push('Stop automatic recovery and require author review.');
  if (warnings.length && !blockers.length) actions.push('Review warnings before continuing with an expensive operation.');

  const status = blockers.length ? 'BLOCKED' : warnings.length ? 'WARNING' : 'READY';
  return {
    workspace_id: workspaceId,
    status,
    confidence: decision.confidence_score,
    reasons: [...blockers, ...warnings],
    blockers,
    warnings,
    recommended_actions: actions,
    metrics: {
      active_incidents: incidents.length,
      sev3_incidents: sev3.length,
      unresolved_continuity_conflicts: continuity.length,
      p99: decision.evidence.runtime.p99,
      rollback_rate: decision.evidence.runtime.rollback_rate,
      max_drift: decision.evidence.max_drift,
      runtime_status: runtime?.status || 'never_run',
      recovery_status: recovery?.status || 'none',
      schema_version: story.schema_version,
      rollback_loop: rollbackLoop,
      migration_failed: migrationFailed
    },
    generated_at: Date.now()
  };
}

export function persistReleaseGate(db, workspaceId, operation = 'release_check', options = {}) {
  const gate = evaluateReleaseGate(db, workspaceId, options);
  if (!gate) return null;

  const auditId = randomUUID();
  const checks = [
    { name: 'sev3_incidents', passed: gate.metrics.sev3_incidents === 0 },
    { name: 'continuity_conflicts', passed: gate.metrics.unresolved_continuity_conflicts === 0 },
    { name: 'runtime', passed: gate.metrics.runtime_status !== 'failed' },
    { name: 'schema', passed: SUPPORTED_SCHEMA_VERSIONS.has(gate.metrics.schema_version || '1.0.0') },
    { name: 'migration', passed: !gate.metrics.migration_failed },
    { name: 'rollback_loop', passed: !gate.metrics.rollback_loop },
    { name: 'confidence', passed: gate.confidence >= Number(options.confidenceThreshold || 75) },
    { name: 'latency', passed: gate.metrics.p99 <= Number(options.p99Limit || 2000) }
  ];

  db.prepare(`
    INSERT INTO release_audits (
      audit_id, workspace_id, result, confidence_score,
      checks_json, blockers_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    auditId,
    workspaceId,
    gate.status,
    gate.confidence,
    JSON.stringify(checks),
    JSON.stringify(gate.blockers),
    Date.now()
  );

  const suffix = gate.status.toLowerCase();
  log(db, {
    workspace_id: workspaceId,
    mode: 'release_gate',
    event_type: `release_gate_${suffix}`,
    payload: {
      audit_id: auditId,
      operation,
      status: gate.status,
      confidence: gate.confidence,
      blockers: gate.blockers,
      warnings: gate.warnings
    },
    rollback: gate.status === 'BLOCKED' ? 1 : 0
  });

  return { ...gate, audit_id: auditId, operation, checks };
}

export function assertReleaseAllowed(db, workspaceId, operation, options = {}) {
  const gate = persistReleaseGate(db, workspaceId, operation, options);
  if (!gate) return { allowed: false, statusCode: 404, gate: null, error: 'Workspace not found' };
  const allowWarning = options.allowWarning !== false;
  const allowed = gate.status === 'READY' || (allowWarning && gate.status === 'WARNING');
  return {
    allowed,
    statusCode: allowed ? 200 : 409,
    gate,
    error: allowed ? null : `Release Gate blocked ${operation}.`
  };
}
