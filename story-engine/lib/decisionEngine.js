// lib/decisionEngine.js

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';
import { creativeProfileContext } from './creativeProfile.js';
import { getOperatorSummary, evaluateOperatorConstraint } from './operatorProfile.js';

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function latestState(db, workspaceId) {
  return db.prepare('SELECT * FROM lindymode_state WHERE workspace_id = ?').get(workspaceId) || null;
}

function activeIncidents(db, workspaceId) {
  return db.prepare(`
    SELECT * FROM lindymode_incidents
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(workspaceId).map(row => ({ ...row, details: safeJson(row.details_json, {}) }));
}

function runtimeStats(db, workspaceId, windowMs = 15 * 60 * 1000) {
  const since = Date.now() - windowMs;
  const rows = db.prepare(`
    SELECT duration_ms, rollback FROM events
    WHERE workspace_id = ? AND created_at >= ?
      AND COALESCE(mode, '') NOT IN ('ooda', 'autonomous_runtime')
      AND event_type NOT LIKE 'runtime.%'
      AND event_type NOT LIKE 'release.%'
  `).all(workspaceId, since);
  const durations = rows.map(row => row.duration_ms).filter(value => value != null).sort((a, b) => a - b);
  const p99 = durations.length ? durations[Math.max(0, Math.ceil(durations.length * 0.99) - 1)] : 0;
  const rollbackRate = rows.length ? rows.filter(row => row.rollback).length / rows.length : 0;
  return { total_events: rows.length, p99, rollback_rate: rollbackRate };
}

function chapterStats(db, workspaceId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN TRIM(COALESCE(content, '')) = '' THEN 1 ELSE 0 END) AS empty_count
    FROM chapters WHERE workspace_id = ?
  `).get(workspaceId);
  return { total: Number(row?.total || 0), empty_count: Number(row?.empty_count || 0) };
}

function buildRecoveryPlan(reasons, incidents) {
  const plan = [];
  const eventTypes = new Set(incidents.map(item => item.event_type));
  if (eventTypes.has('lindymode.context_budget_breach')) {
    plan.push('Rebuild the context pack with a smaller chapter window.');
    plan.push('Refresh the canonical summary before another generation pass.');
  }
  if (eventTypes.has('lindymode.continuity_conflict')) {
    plan.push('Review POV and continuity findings in the affected chapters.');
    plan.push('Update canonical story state, then rerun Lindymode analysis.');
  }
  if (eventTypes.has('lindymode.state_drift_detected')) plan.push('Resolve conflicting story facts or update continuity rules.');
  if (reasons.some(reason => reason.code === 'runtime_tail_latency')) plan.push('Inspect the OODA correlation timeline and reduce expensive processing stages.');
  if (reasons.some(reason => reason.code === 'rollback_rate')) plan.push('Review rollback events and keep the workspace in guarded mode.');
  if (reasons.some(reason => reason.code === 'missing_state')) plan.push('Create canonical Lindymode state before release.');
  if (reasons.some(reason => ['missing_creative_profile', 'incomplete_creative_profile'].includes(reason.code))) {
    plan.push('Tell L99 what story you want to tell and what kind of story it is before OODA plans execution.');
  }
  if (reasons.some(reason => reason.code === 'operator_budget_exceeded')) {
    plan.push('Route the task to a free alternative or ask the operator before spending.');
  }
  if (reasons.some(reason => reason.code === 'empty_chapters')) plan.push('Complete or remove empty chapters before release.');
  return [...new Set(plan)];
}

export function evaluateWorkspace(db, workspaceId) {
  const state = latestState(db, workspaceId);
  const profile = creativeProfileContext(db, workspaceId);
  const profileComplete = Boolean(profile?.story_vision?.trim() && profile?.story_kind?.trim());
  const operator = getOperatorSummary(db);
  const zeroCostConstraint = evaluateOperatorConstraint(db, { estimated_cost: 0, recurring: false });
  const incidents = activeIncidents(db, workspaceId);
  const runtime = runtimeStats(db, workspaceId);
  const chapters = chapterStats(db, workspaceId);
  const reasons = [];

  const criticalIncidents = incidents.filter(item => item.severity === 'sev3');
  const warningIncidents = incidents.filter(item => item.severity === 'sev2');
  const maxDrift = incidents.reduce((max, item) => Math.max(max, Number(item.drift_score || 0)), 0);

  if (!profile) reasons.push({
    code: 'missing_creative_profile', severity: 'warning',
    message: 'Creative Profile is missing; story intent, audience, and medium alignment cannot be verified.'
  });
  else if (!profileComplete) reasons.push({
    code: 'incomplete_creative_profile', severity: 'critical',
    message: 'Story vision and story kind are required before OODA can authorize execution.'
  });
  if (operator.monthly_spend > Number(operator.profile.monthly_budget || 0)) reasons.push({
    code: 'operator_budget_exceeded', severity: 'warning',
    message: 'Operator Profile budget is exceeded; paid execution requires human review.'
  });
  if (!state) reasons.push({ code: 'missing_state', severity: 'warning', message: 'Canonical Lindymode state is missing.' });
  if (criticalIncidents.length) reasons.push({ code: 'critical_drift', severity: 'critical', message: `${criticalIncidents.length} critical story incident(s) active.` });
  if (warningIncidents.length) reasons.push({ code: 'warning_drift', severity: 'warning', message: `${warningIncidents.length} story incident(s) need review.` });
  if (runtime.p99 > 2000) reasons.push({ code: 'runtime_tail_latency', severity: 'critical', message: `Runtime p99 is ${runtime.p99}ms.` });
  else if (runtime.p99 > 1000) reasons.push({ code: 'runtime_tail_latency', severity: 'warning', message: `Runtime p99 is ${runtime.p99}ms.` });
  if (runtime.rollback_rate > 0.05) reasons.push({ code: 'rollback_rate', severity: 'critical', message: `Rollback rate is ${(runtime.rollback_rate * 100).toFixed(1)}%.` });
  else if (runtime.rollback_rate > 0.02) reasons.push({ code: 'rollback_rate', severity: 'warning', message: `Rollback rate is ${(runtime.rollback_rate * 100).toFixed(1)}%.` });
  if (chapters.empty_count > 0) reasons.push({ code: 'empty_chapters', severity: 'warning', message: `${chapters.empty_count} chapter(s) are empty.` });

  let score = 100;
  score -= criticalIncidents.length * 24;
  score -= warningIncidents.length * 12;
  score -= incidents.filter(item => item.severity === 'watch').length * 5;
  score -= Math.round(maxDrift * 20);
  if (!profile) score -= 20;
  else if (!profileComplete) score -= 35;
  if (operator.monthly_spend > Number(operator.profile.monthly_budget || 0)) score -= 8;
  if (!state) score -= 15;
  if (runtime.p99 > 2000) score -= 15;
  else if (runtime.p99 > 1000) score -= 8;
  if (runtime.rollback_rate > 0.05) score -= 15;
  else if (runtime.rollback_rate > 0.02) score -= 8;
  score -= Math.min(10, chapters.empty_count * 2);
  score = Math.max(0, Math.min(100, score));

  const hasCritical = reasons.some(reason => reason.severity === 'critical');
  let action = 'NORMAL';
  if (hasCritical || score < 55) action = 'BLOCK';
  else if (score < 75 || warningIncidents.length >= 2) action = 'RECOVER';
  else if (score < 88 || warningIncidents.length === 1) action = 'INTERVENE';
  else if (reasons.length || score < 95) action = 'WATCH';

  const readiness = action === 'BLOCK' ? 'UNSAFE'
    : action === 'RECOVER' || action === 'INTERVENE' ? 'NEEDS_REVIEW'
      : action === 'WATCH' ? 'EDITING' : 'READY';

  return {
    workspace_id: workspaceId,
    action,
    readiness,
    confidence_score: score,
    reasons,
    recovery_plan: buildRecoveryPlan(reasons, incidents),
    operator_constraints: {
      mode: operator.profile.mode,
      monthly_budget: operator.profile.monthly_budget,
      monthly_spend: operator.monthly_spend,
      approval_threshold: operator.profile.approval_threshold,
      prefer_free: operator.profile.prefer_free,
      require_recurring_approval: operator.profile.require_recurring_approval,
      recommendation: operator.recommendation,
      zero_cost_evaluation: zeroCostConstraint
    },
    strategy: profileComplete ? {
      profile_id: profile.profile_id,
      story_vision: profile.story_vision,
      story_kind: profile.story_kind,
      emotional_effect: profile.emotional_effect,
      medium: profile.medium,
      audience: profile.audience,
      eli_level: profile.eli_level,
      tone: profile.tone,
      goal: profile.goal,
      constraints: profile.constraints,
      outputs: profile.outputs,
      instruction: profile.instructions.profile_instruction,
      require_human_decision: profile.instructions.require_human_decision,
      redteam_pre_runtime: profile.instructions.redteam_pre_runtime,
      redteam_pre_release: profile.instructions.redteam_pre_release
    } : null,
    evidence: {
      creative_profile: profile,
      creative_profile_complete: profileComplete,
      operator_profile: operator.profile,
      operator_summary: operator,
      active_incidents: incidents.length,
      critical_incidents: criticalIncidents.length,
      max_drift: maxDrift,
      runtime,
      chapters,
      state_version: state?.version || null
    },
    generated_at: Date.now()
  };
}

export function persistDecision(db, decision) {
  const decisionId = randomUUID();
  db.prepare(`
    INSERT INTO ooda_decisions (
      decision_id, workspace_id, action, readiness, confidence_score,
      reasons_json, recovery_plan_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    decisionId, decision.workspace_id, decision.action, decision.readiness,
    decision.confidence_score, JSON.stringify(decision.reasons),
    JSON.stringify(decision.recovery_plan), Date.now()
  );
  log(db, {
    workspace_id: decision.workspace_id,
    mode: 'ooda',
    event_type: 'ooda.decision_evaluated',
    payload: {
      decision_id: decisionId,
      action: decision.action,
      readiness: decision.readiness,
      confidence_score: decision.confidence_score,
      operator_mode: decision.operator_constraints?.mode || null,
      profile_id: decision.strategy?.profile_id || null,
      story_kind: decision.strategy?.story_kind || null,
      medium: decision.strategy?.medium || null,
      audience: decision.strategy?.audience || null,
      eli_level: decision.strategy?.eli_level || null
    },
    rollback: decision.action === 'BLOCK' ? 1 : 0
  });
  return { ...decision, decision_id: decisionId };
}

export function runReleaseAudit(db, workspaceId) {
  const decision = evaluateWorkspace(db, workspaceId);
  const checks = [
    { name: 'creative_profile', passed: Boolean(decision.evidence.creative_profile) },
    { name: 'story_intent', passed: decision.evidence.creative_profile_complete },
    { name: 'canonical_state', passed: !decision.reasons.some(item => item.code === 'missing_state') },
    { name: 'continuity', passed: decision.evidence.critical_incidents === 0 },
    { name: 'story_drift', passed: decision.evidence.max_drift < 0.8 },
    { name: 'runtime_latency', passed: decision.evidence.runtime.p99 <= 2000 },
    { name: 'rollback_rate', passed: decision.evidence.runtime.rollback_rate <= 0.05 },
    { name: 'chapter_completeness', passed: decision.evidence.chapters.empty_count === 0 },
    { name: 'confidence', passed: decision.confidence_score >= 75 }
  ];
  const blockers = checks.filter(check => !check.passed).map(check => check.name);
  const result = blockers.length ? 'BLOCKED' : 'READY';
  const auditId = randomUUID();
  db.prepare(`
    INSERT INTO release_audits (
      audit_id, workspace_id, result, confidence_score,
      checks_json, blockers_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(auditId, workspaceId, result, decision.confidence_score, JSON.stringify(checks), JSON.stringify(blockers), Date.now());
  log(db, {
    workspace_id: workspaceId,
    mode: 'ooda',
    event_type: result === 'READY' ? 'release.gate_passed' : 'release.gate_blocked',
    payload: {
      audit_id: auditId,
      result,
      blockers,
      confidence_score: decision.confidence_score,
      creative_profile_id: decision.strategy?.profile_id || null
    },
    rollback: result === 'BLOCKED' ? 1 : 0
  });
  return { audit_id: auditId, workspace_id: workspaceId, result, checks, blockers, decision };
}
