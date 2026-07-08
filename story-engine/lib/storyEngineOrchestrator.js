// lib/storyEngineOrchestrator.js

import { randomUUID } from 'node:crypto';
import * as Story from '../models/storyModel.js';
import { log } from '../models/eventModel.js';
import { upsertCreativeProfile } from './creativeProfile.js';
import { evaluateWorkspace, persistDecision, runReleaseAudit } from './decisionEngine.js';
import { enqueueRuntime } from './runtimeDispatcher.js';
import { evaluateOperatorConstraint } from './operatorProfile.js';
import { generateStoryArtifact, validateArtifactWithPlaywright } from './artifactValidation.js';
import { writeRunSummary } from './runSummary.js';

export const PIPELINE_STAGES = Object.freeze([
  'story_engine',
  'intent_parser',
  'creative_profile',
  'ghost',
  'lindymode',
  'ooda',
  'redteam_pre_runtime',
  'runtime',
  'story_memory',
  'learning_engine',
  'playwright_validation',
  'redteam_pre_release',
  'artifacts',
  'release_gate',
  'control_room',
  'complete'
]);

const MEDIUM_PATTERNS = [
  ['picture_book', /picture book|children(?:'s)? book|kids? book|storybook/i],
  ['movie', /movie|film|screenplay/i],
  ['tv', /tv|television|series|episode|season/i],
  ['song', /song|lyrics|album|music/i],
  ['podcast', /podcast|audio show/i],
  ['game', /game|interactive story|visual novel/i],
  ['comic', /comic|graphic novel|manga/i],
  ['play', /stage play|theatre|theater/i],
  ['short_clip', /short clip|short video|reel|tiktok/i],
  ['book', /novel|book|chapter/i]
];

const KIND_PATTERNS = [
  ['science_fiction', /science fiction|sci-fi|space|future/i],
  ['fantasy', /fantasy|magic|dragon|wizard/i],
  ['mystery', /mystery|detective|crime|whodunit/i],
  ['romance', /romance|love story/i],
  ['horror', /horror|scary|haunted/i],
  ['comedy', /comedy|funny|humor/i],
  ['historical', /historical|history|period piece/i],
  ['thriller', /thriller|suspense/i],
  ['educational', /educational|teach|learn|explain/i],
  ['adventure', /adventure|quest|journey/i],
  ['drama', /drama|family conflict/i]
];

const AUDIENCE_PATTERNS = [
  ['baby', /baby|infant|toddler/i],
  ['eli5', /eli5|five[- ]year[- ]old|5[- ]year[- ]old/i],
  ['eli10', /eli10|ten[- ]year[- ]old|10[- ]year[- ]old/i],
  ['middle_grade', /middle[- ]grade|ages? 8[-– ]?12|preteen/i],
  ['teen', /teen|young teen|high school/i],
  ['young_adult', /young adult|\bya\b/i],
  ['child', /child|children|kid/i],
  ['adult', /adult/i]
];

function pick(text, patterns, fallback) {
  return patterns.find(([, regex]) => regex.test(text))?.[0] || fallback;
}

function titleFromVision(vision) {
  const clean = String(vision || '').replace(/^write (me )?/i, '').trim();
  const words = clean.split(/\s+/).slice(0, 7).join(' ');
  return words ? words.replace(/\b\w/g, char => char.toUpperCase()) : 'Untitled Story';
}

export function parseStoryIntent(input = {}) {
  const vision = String(input.story_vision || input.prompt || '').trim();
  if (!vision) throw new Error('Tell L99 what story you want to create.');
  const medium = String(input.medium || pick(vision, MEDIUM_PATTERNS, 'book')).toLowerCase();
  const audience = String(input.audience || pick(vision, AUDIENCE_PATTERNS, 'adult')).toLowerCase();
  const storyKind = String(input.story_kind || pick(vision, KIND_PATTERNS, 'other')).toLowerCase();
  return {
    story_vision: vision,
    title: String(input.title || titleFromVision(vision)).trim(),
    medium,
    audience,
    story_kind: storyKind,
    emotional_effect: String(input.emotional_effect || 'mixed').toLowerCase(),
    tone: String(input.tone || (audience === 'child' || audience === 'eli5' ? 'gentle' : 'engaging')),
    goal: String(input.goal || 'entertain'),
    constraints: Array.isArray(input.constraints) ? input.constraints : [],
    outputs: Array.isArray(input.outputs) && input.outputs.length ? input.outputs : [medium]
  };
}

export function ensureStoryEngineSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_engine_runs (
      run_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      request_text TEXT NOT NULL,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      active_agent TEXT NOT NULL,
      intent_json TEXT NOT NULL DEFAULT '{}',
      ghost_plan_json TEXT NOT NULL DEFAULT '{}',
      ooda_decision_json TEXT NOT NULL DEFAULT '{}',
      pre_runtime_findings_json TEXT NOT NULL DEFAULT '[]',
      pre_release_findings_json TEXT NOT NULL DEFAULT '[]',
      memory_changes_json TEXT NOT NULL DEFAULT '[]',
      learning_json TEXT NOT NULL DEFAULT '[]',
      artifact_json TEXT NOT NULL DEFAULT '{}',
      dispatch_id TEXT,
      release_audit_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS story_engine_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_engine_runs_status ON story_engine_runs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_story_engine_stage_run ON story_engine_stage_events(run_id, created_at);
  `);
  const columns = db.prepare('PRAGMA table_info(story_engine_runs)').all().map(row => row.name);
  if (!columns.includes('artifact_json')) db.exec(`ALTER TABLE story_engine_runs ADD COLUMN artifact_json TEXT NOT NULL DEFAULT '{}';`);
}

function stageAgent(stage) {
  return {
    story_engine: 'Story Engine',
    intent_parser: 'Intent Parser',
    creative_profile: 'Creative Profile',
    ghost: 'Ghost',
    lindymode: 'Lindymode',
    ooda: 'OODA',
    redteam_pre_runtime: 'Redteam',
    runtime: 'Runtime',
    story_memory: 'Story Memory',
    learning_engine: 'Learning Engine',
    playwright_validation: 'Playwright',
    redteam_pre_release: 'Redteam',
    artifacts: 'Artifact Builder',
    release_gate: 'Release Gate',
    control_room: 'Control Room',
    complete: 'Story Engine'
  }[stage] || 'L99';
}

function setStage(db, runId, workspaceId, stage, status, summary, details = {}) {
  const now = Date.now();
  const agent = stageAgent(stage);
  db.prepare(`
    UPDATE story_engine_runs
    SET current_stage=?, active_agent=?, status=?, updated_at=?
    WHERE run_id=?
  `).run(stage, agent, status, now, runId);
  db.prepare(`
    INSERT INTO story_engine_stage_events (
      run_id, workspace_id, stage, agent, status, summary, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(runId, workspaceId, stage, agent, status, summary, JSON.stringify(details), now);
  log(db, {
    workspace_id: workspaceId,
    mode: 'story_engine',
    event_type: `story_engine.${stage}.${status}`,
    payload: { run_id: runId, stage, agent, summary, ...details }
  });
}

function ensureLindymodeState(db, workspaceId, intent, ghostPlan) {
  const existing = db.prepare('SELECT * FROM lindymode_state WHERE workspace_id=?').get(workspaceId);
  const now = Date.now();
  const state = {
    medium: intent.medium,
    audience: intent.audience,
    story_kind: intent.story_kind,
    emotional_effect: intent.emotional_effect,
    current_goal: ghostPlan.goal,
    pipeline_run: ghostPlan.run_id
  };
  if (existing) {
    db.prepare(`
      UPDATE lindymode_state
      SET summary=?, pov=?, arc_stage=?, token_budget=?, state_json=?, version=version+1, updated_at=?
      WHERE workspace_id=?
    `).run(intent.story_vision, 'undecided', 'concept', 4000, JSON.stringify(state), now, workspaceId);
  } else {
    db.prepare(`
      INSERT INTO lindymode_state (
        workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
      ) VALUES (?, ?, 'undecided', 'concept', 4000, ?, 1, ?)
    `).run(workspaceId, intent.story_vision, JSON.stringify(state), now);
  }
}

function buildGhostPlan(runId, intent) {
  const unitByMedium = {
    picture_book: 'pages', book: 'chapters', movie: 'scenes', tv: 'episodes', song: 'sections',
    podcast: 'segments', game: 'quests', comic: 'panels', play: 'scenes', short_clip: 'shots'
  };
  return {
    run_id: runId,
    goal: `Create a ${intent.story_kind} ${intent.medium} for ${intent.audience}.`,
    units: unitByMedium[intent.medium] || 'story units',
    tasks: [
      'Establish the creative contract.',
      'Build structure and canon.',
      'Draft the first executable story unit.',
      'Validate continuity, audience fit, and operator constraints.',
      'Run browser validation before pre-release Redteam.',
      'Finalize the release artifact after pre-release Redteam.',
      'Write a permanent Control Room run summary.',
      'Prepare the work for human review.'
    ],
    human_decisions: ['Approve paid execution when required.', 'Approve final release.']
  };
}

function runRedteamPreRuntime(intent, decision, operatorCheck) {
  const findings = [];
  if (!intent.story_vision) findings.push({ severity: 'critical', code: 'missing_vision', message: 'Story vision is missing.' });
  if (decision.action === 'BLOCK') findings.push({ severity: 'critical', code: 'ooda_block', message: 'OODA blocked execution.' });
  if (operatorCheck.requires_approval) findings.push({ severity: 'warning', code: 'operator_approval', message: operatorCheck.recommendation });
  return findings;
}

function runRedteamPreRelease(decision, artifactValidation) {
  const findings = [];
  if (!artifactValidation?.passed) findings.push({ severity: 'critical', code: 'playwright_validation_failed', message: 'Playwright validation must pass before pre-release Redteam can clear the run.' });
  if (decision.evidence?.critical_incidents > 0) findings.push({ severity: 'critical', code: 'continuity_conflict', message: 'Critical continuity incidents remain.' });
  if (decision.evidence?.chapters?.empty_count > 0) findings.push({ severity: 'warning', code: 'empty_units', message: 'One or more story units are empty.' });
  if (decision.confidence_score < 75) findings.push({ severity: 'warning', code: 'low_confidence', message: `Confidence is ${decision.confidence_score}%.` });
  return findings;
}

function hydrateRun(db, runId) {
  const row = db.prepare('SELECT * FROM story_engine_runs WHERE run_id=?').get(runId);
  if (!row) return null;
  const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
  return {
    ...row,
    intent: parse(row.intent_json),
    ghost_plan: parse(row.ghost_plan_json),
    ooda_decision: parse(row.ooda_decision_json),
    pre_runtime_findings: parse(row.pre_runtime_findings_json),
    pre_release_findings: parse(row.pre_release_findings_json),
    memory_changes: parse(row.memory_changes_json),
    learning: parse(row.learning_json),
    artifact: parse(row.artifact_json),
    stages: db.prepare('SELECT * FROM story_engine_stage_events WHERE run_id=? ORDER BY created_at ASC, id ASC').all(runId).map(event => ({ ...event, details: parse(event.details_json) }))
  };
}

export function startStoryEngineRun(db, input = {}) {
  ensureStoryEngineSchema(db);
  const intent = parseStoryIntent(input);
  const runId = randomUUID();
  const workspaceId = Story.create(db, { title: intent.title, genre: intent.story_kind, pitch: intent.story_vision });
  const now = Date.now();
  db.prepare(`
    INSERT INTO story_engine_runs (
      run_id, workspace_id, request_text, status, current_stage, active_agent,
      intent_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'running', 'story_engine', 'Story Engine', ?, ?, ?)
  `).run(runId, workspaceId, intent.story_vision, JSON.stringify(intent), now, now);

  try {
    setStage(db, runId, workspaceId, 'story_engine', 'running', 'Unified L99 pipeline started.');
    setStage(db, runId, workspaceId, 'intent_parser', 'completed', `Intent resolved as ${intent.medium} for ${intent.audience}.`, intent);

    const profile = upsertCreativeProfile(db, workspaceId, intent);
    setStage(db, runId, workspaceId, 'creative_profile', 'completed', 'Creative contract resolved.', { profile_id: profile.profile_id, version: profile.version });

    const ghostPlan = buildGhostPlan(runId, intent);
    db.prepare('UPDATE story_engine_runs SET ghost_plan_json=? WHERE run_id=?').run(JSON.stringify(ghostPlan), runId);
    setStage(db, runId, workspaceId, 'ghost', 'completed', 'Ghost decomposed the request into one coordinated plan.', ghostPlan);

    ensureLindymodeState(db, workspaceId, intent, ghostPlan);
    setStage(db, runId, workspaceId, 'lindymode', 'completed', 'Lindymode established creative context and canonical starting state.');

    const decision = persistDecision(db, evaluateWorkspace(db, workspaceId));
    db.prepare('UPDATE story_engine_runs SET ooda_decision_json=? WHERE run_id=?').run(JSON.stringify(decision), runId);
    setStage(db, runId, workspaceId, 'ooda', 'completed', `OODA selected ${decision.action}.`, { decision_id: decision.decision_id, confidence_score: decision.confidence_score, reasons: decision.reasons });

    const operatorCheck = evaluateOperatorConstraint(db, { estimated_cost: Number(input.estimated_cost || 0), recurring: Boolean(input.recurring) });
    const findings = runRedteamPreRuntime(intent, decision, operatorCheck);
    db.prepare('UPDATE story_engine_runs SET pre_runtime_findings_json=? WHERE run_id=?').run(JSON.stringify(findings), runId);
    const blocked = findings.some(finding => finding.severity === 'critical') || operatorCheck.requires_approval;
    setStage(db, runId, workspaceId, 'redteam_pre_runtime', blocked ? 'blocked' : 'completed', blocked ? 'Pre-runtime validation requires human action.' : 'Pre-runtime validation passed.', { findings, operator_check: operatorCheck });

    if (blocked) {
      db.prepare("UPDATE story_engine_runs SET status='awaiting_approval', updated_at=? WHERE run_id=?").run(Date.now(), runId);
      return hydrateRun(db, runId);
    }

    const dispatch = enqueueRuntime(db, workspaceId, 'story_engine_pipeline');
    db.prepare('UPDATE story_engine_runs SET dispatch_id=? WHERE run_id=?').run(dispatch?.dispatch_id || null, runId);
    setStage(db, runId, workspaceId, 'runtime', 'queued', 'Runtime execution queued.', { dispatch_id: dispatch?.dispatch_id || null });
    db.prepare("UPDATE story_engine_runs SET status='runtime_queued', updated_at=? WHERE run_id=?").run(Date.now(), runId);
    return hydrateRun(db, runId);
  } catch (error) {
    db.prepare("UPDATE story_engine_runs SET status='failed', error=?, updated_at=? WHERE run_id=?").run(error.message, Date.now(), runId);
    setStage(db, runId, workspaceId, 'complete', 'failed', error.message);
    throw error;
  }
}

export function approveStoryEngineRun(db, runId) {
  ensureStoryEngineSchema(db);
  const run = hydrateRun(db, runId);
  if (!run) throw new Error('Story Engine run not found.');
  if (run.status !== 'awaiting_approval') throw new Error('Run is not awaiting approval.');
  setStage(db, runId, run.workspace_id, 'redteam_pre_runtime', 'approved', 'Human operator approved execution.');
  const dispatch = enqueueRuntime(db, run.workspace_id, 'story_engine_operator_approved');
  db.prepare("UPDATE story_engine_runs SET dispatch_id=?, status='runtime_queued', updated_at=? WHERE run_id=?").run(dispatch?.dispatch_id || null, Date.now(), runId);
  setStage(db, runId, run.workspace_id, 'runtime', 'queued', 'Runtime execution queued after operator approval.', { dispatch_id: dispatch?.dispatch_id || null });
  return hydrateRun(db, runId);
}

export async function resumeStoryEngineRun(db, runId) {
  ensureStoryEngineSchema(db);
  const run = hydrateRun(db, runId);
  if (!run) throw new Error('Story Engine run not found.');
  if (['complete', 'failed', 'awaiting_approval'].includes(run.status)) return run;
  const dispatch = run.dispatch_id
    ? db.prepare('SELECT * FROM runtime_dispatch_queue WHERE dispatch_id=?').get(run.dispatch_id)
    : null;
  if (!dispatch || ['queued', 'running'].includes(dispatch.status)) return run;
  if (dispatch.status === 'failed') {
    db.prepare("UPDATE story_engine_runs SET status='failed', error=?, updated_at=? WHERE run_id=?").run(dispatch.error || 'Runtime failed.', Date.now(), runId);
    setStage(db, runId, run.workspace_id, 'runtime', 'failed', dispatch.error || 'Runtime failed.');
    return hydrateRun(db, runId);
  }

  setStage(db, runId, run.workspace_id, 'runtime', 'completed', 'Runtime execution completed.', { dispatch_id: dispatch.dispatch_id, runtime_run_id: dispatch.run_id });
  const memoryChanges = [{ type: 'canonical_state', action: 'confirmed', workspace_id: run.workspace_id }];
  db.prepare('UPDATE story_engine_runs SET memory_changes_json=? WHERE run_id=?').run(JSON.stringify(memoryChanges), runId);
  setStage(db, runId, run.workspace_id, 'story_memory', 'completed', 'Story Memory checkpoint recorded.', { changes: memoryChanges });

  const learning = [{ lesson: 'Unified pipeline completed runtime without bypassing operator constraints.', source: 'story_engine_run' }];
  db.prepare('UPDATE story_engine_runs SET learning_json=? WHERE run_id=?').run(JSON.stringify(learning), runId);
  setStage(db, runId, run.workspace_id, 'learning_engine', 'completed', 'Learning Engine recorded the execution lesson.', { learning });

  const previewArtifact = generateStoryArtifact(db, { runId, workspaceId: run.workspace_id, intent: run.intent });
  const validatedArtifact = await validateArtifactWithPlaywright(db, previewArtifact.artifact_id);
  db.prepare('UPDATE story_engine_runs SET artifact_json=? WHERE run_id=?').run(JSON.stringify({ artifact_id: validatedArtifact.artifact_id, status: validatedArtifact.status, title: validatedArtifact.title, validation: validatedArtifact.validation, phase: 'playwright_preview' }), runId);
  setStage(db, runId, run.workspace_id, 'playwright_validation', validatedArtifact.validation.passed ? 'completed' : 'blocked', validatedArtifact.validation.passed ? 'Runtime surface passed Playwright validation.' : 'Runtime surface failed Playwright validation.', { artifact_id: validatedArtifact.artifact_id, validation: validatedArtifact.validation });

  const decision = evaluateWorkspace(db, run.workspace_id);
  const findings = runRedteamPreRelease(decision, validatedArtifact.validation);
  db.prepare('UPDATE story_engine_runs SET pre_release_findings_json=? WHERE run_id=?').run(JSON.stringify(findings), runId);
  const critical = findings.some(finding => finding.severity === 'critical');
  setStage(db, runId, run.workspace_id, 'redteam_pre_release', critical ? 'blocked' : 'completed', critical ? 'Pre-release Redteam blocked final artifact.' : 'Pre-release Redteam cleared the validated surface.', { findings });

  const finalArtifact = validatedArtifact;
  db.prepare('UPDATE story_engine_runs SET artifact_json=? WHERE run_id=?').run(JSON.stringify({ artifact_id: finalArtifact.artifact_id, status: finalArtifact.status, title: finalArtifact.title, validation: finalArtifact.validation, phase: critical ? 'artifact_needs_review' : 'release_candidate' }), runId);
  setStage(db, runId, run.workspace_id, 'artifacts', critical ? 'blocked' : 'completed', critical ? 'Artifact retained as review candidate after Redteam block.' : 'Final release candidate artifact prepared.', { artifact_id: finalArtifact.artifact_id, title: finalArtifact.title, status: finalArtifact.status });

  const audit = runReleaseAudit(db, run.workspace_id);
  db.prepare('UPDATE story_engine_runs SET release_audit_id=? WHERE run_id=?').run(audit.audit_id, runId);
  setStage(db, runId, run.workspace_id, 'release_gate', audit.result === 'READY' ? 'completed' : 'blocked', `Release Gate result: ${audit.result}.`, { audit_id: audit.audit_id, blockers: audit.blockers });

  const finalStatus = audit.result === 'READY' && !critical ? 'complete' : 'needs_review';
  const summary = writeRunSummary(db, runId, {
    final_status: finalStatus,
    release_result: audit.result,
    confidence_before: run.ooda_decision?.confidence_score,
    confidence_after: audit.confidence_score,
    estimated_cost: 0
  });
  setStage(db, runId, run.workspace_id, 'control_room', 'completed', 'Control Room recorded the permanent run history.', {
    summary_id: summary.summary_id,
    final_status: finalStatus,
    release_result: audit.result,
    blockers: summary.blockers,
    confidence_before: summary.confidence_before,
    confidence_after: summary.confidence_after
  });

  db.prepare('UPDATE story_engine_runs SET status=?, current_stage=?, active_agent=?, updated_at=?, completed_at=? WHERE run_id=?')
    .run(finalStatus, finalStatus === 'complete' ? 'complete' : 'release_gate', finalStatus === 'complete' ? 'Story Engine' : 'Release Gate', Date.now(), finalStatus === 'complete' ? Date.now() : null, runId);
  if (finalStatus === 'complete') setStage(db, runId, run.workspace_id, 'complete', 'completed', 'L99 OS Alpha pipeline completed and is ready for human review.');
  return hydrateRun(db, runId);
}

export async function getStoryEngineRun(db, runId, { resume = true } = {}) {
  ensureStoryEngineSchema(db);
  return resume ? await resumeStoryEngineRun(db, runId) : hydrateRun(db, runId);
}

export function listStoryEngineRuns(db, limit = 50) {
  ensureStoryEngineSchema(db);
  return db.prepare(`
    SELECT run_id, workspace_id, request_text, status, current_stage, active_agent,
           dispatch_id, release_audit_id, error, created_at, updated_at, completed_at
    FROM story_engine_runs ORDER BY updated_at DESC LIMIT ?
  `).all(Math.max(1, Math.min(200, Number(limit) || 50)));
}

export function storyEngineBrainSnapshot(db) {
  ensureStoryEngineSchema(db);
  const runs = listStoryEngineRuns(db, 25);
  const active = runs.filter(run => !['complete', 'failed'].includes(run.status));
  return {
    active_runs: active,
    recent_runs: runs,
    active_count: active.length,
    current: active[0] || runs[0] || null,
    pipeline_stages: PIPELINE_STAGES
  };
}
