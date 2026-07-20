// lib/lindymodeProcessor.js
// Lindy Mode combines chapter drift analysis with bootstrap-first founder discipline.

import { createIncident, getState, reconcileChapterIncidents } from '../models/lindymodeModel.js';
import { log } from '../models/eventModel.js';
import { canonSnapshot, evaluateCanonFit } from './canonMemory.js';

const DEFAULT_LINDY_PROFILE = Object.freeze({
  mode: 'bootstrap',
  prefer_free: true,
  approval_threshold: 0,
  principle: 'Being broke is the Lindy filter: spend only when the simpler free path no longer protects quality, reliability, or revenue.'
});

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalize(value) {
  return String(value || '').toLowerCase();
}

function testRule(content, rule) {
  const text = normalize(content);
  const value = normalize(rule.value);

  if (rule.type === 'required_phrase') {
    return text.includes(value) ? null : `Missing required phrase: ${rule.value}`;
  }
  if (rule.type === 'forbidden_phrase') {
    return text.includes(value) ? `Forbidden phrase present: ${rule.value}` : null;
  }
  if (rule.type === 'required_entity') {
    return text.includes(value) ? null : `Expected continuity entity absent: ${rule.value}`;
  }
  return null;
}

function detectPovConflict(content, expectedPov) {
  if (!expectedPov) return null;
  const text = normalize(content);
  if (expectedPov === 'first_person' && !/\b(i|me|my|mine|we|our)\b/.test(text)) {
    return 'Expected first-person POV markers were not detected.';
  }
  if (expectedPov === 'third_person' && /\b(i|me|my|mine)\b/.test(text)) {
    return 'First-person POV markers conflict with third-person story state.';
  }
  return null;
}

function logResolved(db, chapter, resolved, correlationId) {
  if (!resolved.length) return;
  log(db, {
    workspace_id: chapter.workspace_id,
    mode: 'lindymode',
    event_type: 'lindymode.incidents_auto_resolved',
    payload: {
      correlation_id: correlationId,
      chapter_id: chapter.id,
      incident_ids: resolved.map(item => item.incident_id),
      recovery_action: 'author_fix_validated'
    }
  });
}

export function analyzeChapter(db, chapter, options = {}) {
  const state = getState(db, chapter.workspace_id);
  if (!state) return { incidents: [], resolved_incidents: [], state_missing: true };

  const content = chapter.content || chapter.text || '';
  const rules = Array.isArray(state.state?.continuity_rules)
    ? state.state.continuity_rules
    : [];

  const findings = [];
  const povConflict = detectPovConflict(content, state.pov);
  if (povConflict) findings.push({ type: 'pov_conflict', message: povConflict, weight: 0.35 });

  for (const rule of rules) {
    const message = testRule(content, rule);
    if (message) findings.push({ type: rule.type, message, weight: Number(rule.weight || 0.25) });
  }

  const tokenEstimate = Math.ceil(content.length / 4);
  if (state.token_budget > 0 && tokenEstimate > state.token_budget) {
    findings.push({
      type: 'context_budget_breach',
      message: `Estimated token count ${tokenEstimate} exceeds budget ${state.token_budget}.`,
      weight: 0.4
    });
  }

  const correlationId = options.correlation_id || id('inc_lindy');

  if (!findings.length) {
    const resolved = reconcileChapterIncidents(db, chapter.workspace_id, chapter.id, null);
    logResolved(db, chapter, resolved, correlationId);
    return {
      incidents: [],
      resolved_incidents: resolved,
      drift_score: 0,
      token_estimate: tokenEstimate
    };
  }

  const driftScore = Math.min(1, findings.reduce((sum, finding) => sum + finding.weight, 0));
  const severity = driftScore >= 0.8 ? 'sev3' : driftScore >= 0.5 ? 'sev2' : 'watch';
  const eventType = findings.some(finding => finding.type === 'context_budget_breach')
    ? 'lindymode.context_budget_breach'
    : findings.some(finding => finding.type === 'pov_conflict')
      ? 'lindymode.continuity_conflict'
      : 'lindymode.state_drift_detected';
  const reason = findings.map(finding => finding.message).join(' | ');

  const resolved = reconcileChapterIncidents(db, chapter.workspace_id, chapter.id, {
    event_type: eventType,
    reason
  });
  logResolved(db, chapter, resolved, correlationId);

  const incident = createIncident(db, {
    incident_id: id('lindy'),
    correlation_id: correlationId,
    parent_event_id: options.parent_event_id,
    workspace_id: chapter.workspace_id,
    chapter_id: chapter.id,
    event_type: eventType,
    severity,
    reason,
    drift_score: driftScore,
    details: {
      findings,
      chapter_title: chapter.title,
      arc_stage: state.arc_stage,
      pov: state.pov,
      state_version: state.version,
      token_estimate: tokenEstimate
    }
  });

  log(db, {
    workspace_id: chapter.workspace_id,
    mode: 'lindymode',
    event_type: eventType,
    payload: {
      incident_id: incident.incident_id,
      correlation_id: correlationId,
      chapter_id: chapter.id,
      drift_score: driftScore,
      severity
    },
    rollback: severity === 'sev3' ? 1 : 0
  });

  return {
    incidents: [incident],
    resolved_incidents: resolved,
    drift_score: driftScore,
    token_estimate: tokenEstimate
  };
}

export function getLindyProfile(db) {
  try {
    const row = db.prepare("SELECT value FROM operator_config WHERE key='lindy_profile'").get();
    if (row) return { ...DEFAULT_LINDY_PROFILE, ...JSON.parse(row.value) };
  } catch {
    // Older or synthetic databases may not contain operator_config.
  }
  return { ...DEFAULT_LINDY_PROFILE };
}

export function lindyModeDecision({ action = 'stay', lindy_score = 100, monthly_cost = 0, profile = DEFAULT_LINDY_PROFILE } = {}) {
  const threshold = Number(profile.approval_threshold || 0);
  const preferFree = Boolean(profile.prefer_free);
  const reasons = [];
  let approved = true;

  if (preferFree && monthly_cost > 0) {
    reasons.push(`Bootstrap Mode prefers a free alternative until the cost proves measurable value. Monthly cost: $${monthly_cost}.`);
    approved = false;
  }
  if (monthly_cost > threshold && threshold >= 0) {
    reasons.push(`Monthly cost $${monthly_cost} exceeds operator approval threshold $${threshold}.`);
    approved = false;
  }
  if (lindy_score < 50) {
    reasons.push(`Lindy score ${lindy_score} is below the minimum confidence threshold (50).`);
    approved = false;
  }
  if (!reasons.length) reasons.push('No cost or quality pressure requires a change. Stay lean.');

  return {
    action,
    lindy_score,
    monthly_cost,
    approved,
    mode: profile.mode,
    principle: profile.principle,
    reasons
  };
}

export function lindyCreativeCheck(db, workspace_id, draft) {
  const canon = evaluateCanonFit(db, workspace_id, draft);
  const snapshot = canonSnapshot(db, workspace_id);
  return {
    canon_passed: canon.passed,
    canon_findings: canon.findings,
    canon_anchor_count: snapshot.anchor_count,
    canon_locked_count: snapshot.locked_count,
    canon_kinds: snapshot.kinds
  };
}

export function lindyCommandOptions() {
  return [
    { command: '/lindy status', description: 'Show current Lindy Mode profile and bootstrap stack health.' },
    { command: '/lindy canon', description: 'Show all canon anchors for the current workspace.' },
    { command: '/lindy check', description: 'Run a canon fit check on the latest draft unit.' },
    { command: '/lindy lock <key>', description: 'Lock a canon anchor so it cannot be overwritten by AI output.' }
  ];
}
