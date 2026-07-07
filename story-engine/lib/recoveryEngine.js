// lib/recoveryEngine.js

import { randomUUID } from 'node:crypto';
import * as Lindy from '../models/lindymodeModel.js';
import * as Chapter from '../models/chapterModel.js';
import { analyzeChapter } from './lindymodeProcessor.js';
import { evaluateWorkspace } from './decisionEngine.js';
import { captureEpisodeFromIncident } from './learningEngine.js';
import { log } from '../models/eventModel.js';

const SAFE_STRATEGIES = new Set([
  'raise_context_budget',
  'refresh_state_metadata',
  'resolve_after_author_fix'
]);

function snapshotState(db, workspaceId) {
  const state = Lindy.getState(db, workspaceId);
  return state ? {
    summary: state.summary,
    pov: state.pov,
    arc_stage: state.arc_stage,
    token_budget: state.token_budget,
    state: state.state,
    version: state.version
  } : null;
}

function chooseStrategy(incident) {
  if (incident.event_type === 'lindymode.context_budget_breach') return 'raise_context_budget';
  if (incident.event_type === 'lindymode.continuity_conflict') return 'resolve_after_author_fix';
  return 'refresh_state_metadata';
}

function applyStrategy(db, incident, strategy) {
  const state = Lindy.getState(db, incident.workspace_id);
  if (!state) throw new Error('Canonical Lindymode state is missing.');

  if (strategy === 'raise_context_budget') {
    const tokenEstimate = Number(incident.details?.token_estimate || 0);
    const nextBudget = Math.max(Number(state.token_budget || 0), Math.ceil(tokenEstimate * 1.15));
    return Lindy.upsertState(db, incident.workspace_id, { token_budget: nextBudget });
  }

  if (strategy === 'refresh_state_metadata') {
    return Lindy.upsertState(db, incident.workspace_id, {
      state: {
        ...state.state,
        last_recovery_at: Date.now(),
        last_recovery_incident: incident.incident_id
      }
    });
  }

  if (strategy === 'resolve_after_author_fix') {
    return state;
  }

  throw new Error(`Unsupported recovery strategy: ${strategy}`);
}

export function planRecovery(db, incidentId) {
  const incident = Lindy.getIncident(db, incidentId);
  if (!incident) return null;
  const strategy = chooseStrategy(incident);

  return {
    incident_id: incidentId,
    workspace_id: incident.workspace_id,
    strategy,
    reversible: strategy !== 'resolve_after_author_fix',
    requires_author: strategy === 'resolve_after_author_fix',
    reason: strategy === 'raise_context_budget'
      ? 'Context budget can be adjusted safely and revalidated.'
      : strategy === 'refresh_state_metadata'
        ? 'Canonical metadata can be refreshed without editing manuscript text.'
        : 'POV and continuity conflicts require author approval before resolution.'
  };
}

export function runRecovery(db, incidentId, requestedStrategy = null) {
  const incident = Lindy.getIncident(db, incidentId);
  if (!incident) return null;

  const strategy = requestedStrategy || chooseStrategy(incident);
  if (!SAFE_STRATEGIES.has(strategy)) throw new Error('Recovery strategy is not allowed.');

  const runId = randomUUID();
  const beforeState = snapshotState(db, incident.workspace_id);
  const beforeDecision = evaluateWorkspace(db, incident.workspace_id);
  let status = 'planned';
  let afterState = beforeState;
  let validation = { passed: false, reason: 'Not executed.' };

  db.prepare(`
    INSERT INTO ooda_recovery_runs (
      run_id, workspace_id, incident_id, strategy, status, reversible,
      before_json, after_json, validation_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    incident.workspace_id,
    incident.incident_id,
    strategy,
    status,
    strategy === 'resolve_after_author_fix' ? 0 : 1,
    JSON.stringify({ state: beforeState, decision: beforeDecision }),
    '{}',
    '{}',
    Date.now()
  );

  if (strategy === 'resolve_after_author_fix') {
    validation = {
      passed: false,
      reason: 'Author review required. No manuscript content was changed.'
    };
    status = 'awaiting_author';
  } else {
    afterState = applyStrategy(db, incident, strategy);
    const chapter = Chapter.get(db, Number(incident.chapter_id));
    const analysis = chapter ? analyzeChapter(db, chapter, { correlation_id: incident.correlation_id }) : { incidents: [] };
    const remaining = Array.isArray(analysis.incidents) ? analysis.incidents : [];
    validation = {
      passed: remaining.length === 0,
      remaining_incidents: remaining.map(item => item.incident_id),
      drift_score: Number(analysis.drift_score || 0)
    };

    if (validation.passed) {
      Lindy.resolveIncident(db, incident.incident_id, strategy);
      status = 'validated';
      captureEpisodeFromIncident(db, incident.incident_id, 'success');
    } else {
      if (beforeState) Lindy.upsertState(db, incident.workspace_id, beforeState);
      status = 'rolled_back';
      captureEpisodeFromIncident(db, incident.incident_id, 'failed');
    }
  }

  const afterDecision = evaluateWorkspace(db, incident.workspace_id);
  db.prepare(`
    UPDATE ooda_recovery_runs
    SET status = ?, after_json = ?, validation_json = ?, completed_at = ?
    WHERE run_id = ?
  `).run(
    status,
    JSON.stringify({ state: afterState, decision: afterDecision }),
    JSON.stringify(validation),
    Date.now(),
    runId
  );

  log(db, {
    workspace_id: incident.workspace_id,
    mode: 'ooda',
    event_type: `ooda.recovery_${status}`,
    payload: {
      run_id: runId,
      incident_id: incident.incident_id,
      strategy,
      validation
    },
    rollback: status === 'rolled_back' ? 1 : 0
  });

  return getRecoveryRun(db, runId);
}

export function getRecoveryRun(db, runId) {
  const row = db.prepare('SELECT * FROM ooda_recovery_runs WHERE run_id = ?').get(runId);
  if (!row) return null;
  return {
    ...row,
    before: JSON.parse(row.before_json || '{}'),
    after: JSON.parse(row.after_json || '{}'),
    validation: JSON.parse(row.validation_json || '{}')
  };
}

export function listRecoveryRuns(db, workspaceId, limit = 100) {
  return db.prepare(`
    SELECT * FROM ooda_recovery_runs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit).map(row => ({
    ...row,
    before: JSON.parse(row.before_json || '{}'),
    after: JSON.parse(row.after_json || '{}'),
    validation: JSON.parse(row.validation_json || '{}')
  }));
}
