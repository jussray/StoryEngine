// lib/runSummary.js

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';
import { getOperatorSummary } from './operatorProfile.js';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function ensureRunSummarySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_room_run_summaries (
      summary_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      final_status TEXT NOT NULL,
      release_result TEXT,
      confidence_before REAL,
      confidence_after REAL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      tracked_monthly_spend REAL NOT NULL DEFAULT 0,
      tracked_monthly_revenue REAL NOT NULL DEFAULT 0,
      operator_mode TEXT,
      models_json TEXT NOT NULL DEFAULT '[]',
      approvals_json TEXT NOT NULL DEFAULT '[]',
      blockers_json TEXT NOT NULL DEFAULT '[]',
      redteam_json TEXT NOT NULL DEFAULT '{}',
      memory_json TEXT NOT NULL DEFAULT '[]',
      learning_json TEXT NOT NULL DEFAULT '[]',
      artifact_json TEXT NOT NULL DEFAULT '{}',
      stage_timings_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_control_room_run_summaries_workspace
      ON control_room_run_summaries(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_control_room_run_summaries_status
      ON control_room_run_summaries(final_status, created_at);
  `);
}

function stageTimings(events = []) {
  return events.map((event, index) => {
    const next = events[index + 1];
    return {
      stage: event.stage,
      agent: event.agent,
      status: event.status,
      started_at: Number(event.created_at || 0),
      ended_at: next ? Number(next.created_at || 0) : Number(event.created_at || 0),
      duration_ms: next ? Math.max(0, Number(next.created_at || 0) - Number(event.created_at || 0)) : 0,
      summary: event.summary
    };
  });
}

function modelsUsed(db, workspaceId, since) {
  const rows = db.prepare(`
    SELECT payload
    FROM events
    WHERE workspace_id=? AND created_at>=?
      AND (event_type LIKE 'llm.%' OR event_type LIKE 'model.%')
    ORDER BY created_at ASC
  `).all(workspaceId, since);
  const found = new Set();
  for (const row of rows) {
    const payload = parseJson(row.payload, {});
    for (const value of [payload.model, payload.provider, payload.route]) {
      if (value) found.add(String(value));
    }
  }
  return [...found];
}

export function writeRunSummary(db, runId, input = {}) {
  ensureRunSummarySchema(db);
  const run = db.prepare('SELECT * FROM story_engine_runs WHERE run_id=?').get(runId);
  if (!run) throw new Error('Story Engine run not found for Control Room summary.');

  const stages = db.prepare(`
    SELECT stage, agent, status, summary, details_json, created_at
    FROM story_engine_stage_events
    WHERE run_id=?
    ORDER BY created_at ASC, id ASC
  `).all(runId).map(row => ({ ...row, details: parseJson(row.details_json, {}) }));

  const operator = getOperatorSummary(db);
  const ooda = parseJson(run.ooda_decision_json, {});
  const preRuntime = parseJson(run.pre_runtime_findings_json, []);
  const preRelease = parseJson(run.pre_release_findings_json, []);
  const memory = parseJson(run.memory_changes_json, []);
  const learning = parseJson(run.learning_json, []);
  const artifact = parseJson(run.artifact_json, {});
  const audit = run.release_audit_id
    ? db.prepare('SELECT * FROM release_audits WHERE audit_id=?').get(run.release_audit_id)
    : null;
  const blockers = audit ? parseJson(audit.blockers_json, []) : [];
  const timings = stageTimings(stages);
  const approvals = stages
    .filter(stage => stage.status === 'approved' || /operator approved/i.test(stage.summary || ''))
    .map(stage => ({ stage: stage.stage, summary: stage.summary, created_at: stage.created_at }));
  const models = modelsUsed(db, run.workspace_id, run.created_at);
  const confidenceBefore = Number(input.confidence_before ?? ooda.confidence_score ?? 0);
  const confidenceAfter = Number(input.confidence_after ?? audit?.confidence_score ?? ooda.confidence_score ?? 0);
  const finalStatus = String(input.final_status || run.status || 'unknown');
  const releaseResult = String(input.release_result || audit?.result || 'UNKNOWN');
  const estimatedCost = Number(input.estimated_cost || 0);

  const humanSummary = {
    run_id: runId,
    workspace_id: run.workspace_id,
    request: run.request_text,
    outcome: finalStatus,
    release_result: releaseResult,
    why_ooda_decided: ooda.reasons || [],
    redteam_pre_runtime: preRuntime,
    redteam_pre_release: preRelease,
    memory_changes: memory,
    lessons: learning,
    playwright: artifact.validation || null,
    artifact,
    blockers,
    approvals,
    models,
    confidence: { before: confidenceBefore, after: confidenceAfter },
    operator: {
      mode: operator.profile.mode,
      monthly_spend: operator.monthly_spend,
      monthly_revenue: operator.monthly_revenue
    }
  };

  const now = Date.now();
  const existing = db.prepare('SELECT summary_id FROM control_room_run_summaries WHERE run_id=?').get(runId);
  const summaryId = existing?.summary_id || `summary_${randomUUID()}`;

  db.prepare(`
    INSERT INTO control_room_run_summaries (
      summary_id, run_id, workspace_id, final_status, release_result,
      confidence_before, confidence_after, estimated_cost,
      tracked_monthly_spend, tracked_monthly_revenue, operator_mode,
      models_json, approvals_json, blockers_json, redteam_json,
      memory_json, learning_json, artifact_json, stage_timings_json,
      summary_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      final_status=excluded.final_status,
      release_result=excluded.release_result,
      confidence_before=excluded.confidence_before,
      confidence_after=excluded.confidence_after,
      estimated_cost=excluded.estimated_cost,
      tracked_monthly_spend=excluded.tracked_monthly_spend,
      tracked_monthly_revenue=excluded.tracked_monthly_revenue,
      operator_mode=excluded.operator_mode,
      models_json=excluded.models_json,
      approvals_json=excluded.approvals_json,
      blockers_json=excluded.blockers_json,
      redteam_json=excluded.redteam_json,
      memory_json=excluded.memory_json,
      learning_json=excluded.learning_json,
      artifact_json=excluded.artifact_json,
      stage_timings_json=excluded.stage_timings_json,
      summary_json=excluded.summary_json,
      updated_at=excluded.updated_at
  `).run(
    summaryId,
    runId,
    run.workspace_id,
    finalStatus,
    releaseResult,
    confidenceBefore,
    confidenceAfter,
    estimatedCost,
    Number(operator.monthly_spend || 0),
    Number(operator.monthly_revenue || 0),
    operator.profile.mode,
    JSON.stringify(models),
    JSON.stringify(approvals),
    JSON.stringify(blockers),
    JSON.stringify({ pre_runtime: preRuntime, pre_release: preRelease }),
    JSON.stringify(memory),
    JSON.stringify(learning),
    JSON.stringify(artifact),
    JSON.stringify(timings),
    JSON.stringify(humanSummary),
    now,
    now
  );

  log(db, {
    workspace_id: run.workspace_id,
    mode: 'control_room',
    event_type: 'control_room.run_summary_written',
    payload: { summary_id: summaryId, run_id: runId, final_status: finalStatus, release_result: releaseResult }
  });

  return getRunSummary(db, runId);
}

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    models: parseJson(row.models_json, []),
    approvals: parseJson(row.approvals_json, []),
    blockers: parseJson(row.blockers_json, []),
    redteam: parseJson(row.redteam_json, {}),
    memory: parseJson(row.memory_json, []),
    learning: parseJson(row.learning_json, []),
    artifact: parseJson(row.artifact_json, {}),
    stage_timings: parseJson(row.stage_timings_json, []),
    summary: parseJson(row.summary_json, {})
  };
}

export function getRunSummary(db, runId) {
  ensureRunSummarySchema(db);
  return hydrate(db.prepare('SELECT * FROM control_room_run_summaries WHERE run_id=?').get(runId));
}

export function listRunSummaries(db, limit = 25) {
  ensureRunSummarySchema(db);
  return db.prepare(`
    SELECT * FROM control_room_run_summaries
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, Number(limit) || 25))).map(hydrate);
}
