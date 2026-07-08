// lib/lindymodeProcessor.js

import { createIncident, getState, reconcileChapterIncidents } from '../models/lindymodeModel.js';
import { log } from '../models/eventModel.js';

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
  const eventType = findings.some(f => f.type === 'context_budget_breach')
    ? 'lindymode.context_budget_breach'
    : findings.some(f => f.type === 'pov_conflict')
      ? 'lindymode.continuity_conflict'
      : 'lindymode.state_drift_detected';
  const reason = findings.map(f => f.message).join(' | ');

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
