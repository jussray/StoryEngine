import { randomUUID } from 'node:crypto';
import * as Story from '../models/storyModel.js';
import { log } from '../models/eventModel.js';
import { upsertCreativeProfile } from './creativeProfile.js';
import {
  ASSIST_MODES,
  getOperatorAssistDefault,
  setWorkspaceAssist,
  recordAssistContribution
} from './assistMode.js';
import {
  ensureStoryEngineSchema,
  parseStoryIntent,
  getStoryEngineRun
} from './storyEngineOrchestrator.js';
import { ensureRuntimeDispatchSchema } from './runtimeDispatcher.js';

const LEGACY_MODE_MAP = Object.freeze({
  human_first: 'writer',
  system_first: 'director'
});

export const HUMAN_LED_ASSIST_MODES = Object.freeze(['writer', 'co_writer']);

export function resolveStoryEngineAssistMode(db, requestedMode) {
  const fallback = getOperatorAssistDefault(db).default_assist_mode;
  const raw = String(requestedMode || fallback).trim().toLowerCase();
  const mode = LEGACY_MODE_MAP[raw] || raw;
  if (!ASSIST_MODES.includes(mode)) throw new Error(`Unsupported assist mode: ${mode}.`);
  return mode;
}

export function isHumanLedAssistMode(mode) {
  return HUMAN_LED_ASSIST_MODES.includes(mode);
}

function addStageEvidence(db, { runId, workspaceId, stage, agent, summary, details = {} }) {
  db.prepare(`
    INSERT INTO story_engine_stage_events (
      run_id, workspace_id, stage, agent, status, summary, details_json, created_at
    ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)
  `).run(runId, workspaceId, stage, agent, summary, JSON.stringify(details), Date.now());
}

export async function startHumanLedStoryEngineRun(db, input = {}, resolvedMode = null) {
  ensureStoryEngineSchema(db);
  ensureRuntimeDispatchSchema(db);
  const mode = resolvedMode || resolveStoryEngineAssistMode(db, input.assist_mode);
  if (!isHumanLedAssistMode(mode)) {
    throw new Error(`Human-led Story Engine initialization does not accept assist mode: ${mode}.`);
  }

  const intent = parseStoryIntent(input);
  const runId = randomUUID();
  const workspaceId = Story.create(db, {
    title: intent.title,
    genre: intent.story_kind,
    pitch: intent.story_vision
  });
  const now = Date.now();
  const status = mode === 'writer' ? 'writer_active' : 'co_writer_ready';
  const activeAgent = mode === 'writer' ? 'Human' : 'Human + L99';

  db.prepare(`
    INSERT INTO story_engine_runs (
      run_id, workspace_id, request_text, status, current_stage, active_agent,
      intent_json, ghost_plan_json, ooda_decision_json,
      pre_runtime_findings_json, pre_release_findings_json,
      memory_changes_json, learning_json, artifact_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'story_engine', ?, ?, '{}', '{}', '[]', '[]', '[]', '[]', '{}', ?, ?)
  `).run(
    runId,
    workspaceId,
    intent.story_vision,
    status,
    activeAgent,
    JSON.stringify(intent),
    now,
    now
  );

  addStageEvidence(db, {
    runId,
    workspaceId,
    stage: 'story_engine',
    agent: 'Story Engine',
    summary: `Human-led ${mode} session initialized before provider drafting.`
  });
  addStageEvidence(db, {
    runId,
    workspaceId,
    stage: 'intent_parser',
    agent: 'Intent Parser',
    summary: `Intent resolved as ${intent.medium} for ${intent.audience}.`,
    details: intent
  });

  const profile = upsertCreativeProfile(db, workspaceId, intent);
  addStageEvidence(db, {
    runId,
    workspaceId,
    stage: 'creative_profile',
    agent: 'Creative Profile',
    summary: 'Creative contract resolved before any model drafting.',
    details: { profile_id: profile.profile_id, version: profile.version }
  });

  const assistProfile = setWorkspaceAssist(db, workspaceId, { assist_mode: mode });
  recordAssistContribution(db, {
    workspace_id: workspaceId,
    source: mode === 'writer' ? 'human' : 'shared',
    action: mode === 'writer' ? 'writer_workspace_started' : 'co_writer_workspace_started',
    metadata: { assist_mode: mode, run_id: runId, provider_work_started: false }
  });

  log(db, {
    workspace_id: workspaceId,
    mode: 'assist_mode',
    event_type: `assist.role.${mode}.activated_before_provider`,
    payload: {
      run_id: runId,
      permissions: assistProfile.permissions,
      provider_work_started: false,
      ghost_commands: []
    }
  });

  const run = await getStoryEngineRun(db, runId, { resume: false });
  return { ...run, assist_profile: assistProfile };
}
