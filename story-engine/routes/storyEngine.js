// routes/storyEngine.js

import { json } from '../lib/miniRouter.js';
import {
  PIPELINE_STAGES,
  parseStoryIntent,
  startStoryEngineRun,
  approveStoryEngineRun,
  getStoryEngineRun,
  listStoryEngineRuns,
  storyEngineBrainSnapshot
} from '../lib/storyEngineOrchestrator.js';
import {
  ASSIST_MODES,
  getOperatorAssistDefault,
  setWorkspaceAssist,
  recordAssistContribution
} from '../lib/assistMode.js';
import { log } from '../models/eventModel.js';

function cancelQueuedDispatch(db, dispatchId) {
  if (!dispatchId) return;
  db.prepare(`
    UPDATE runtime_dispatch_queue
    SET status='cancelled', completed_at=?
    WHERE dispatch_id=? AND status='queued'
  `).run(Date.now(), dispatchId);
}

function setRunRoleState(db, runId, status, activeAgent) {
  db.prepare(`
    UPDATE story_engine_runs
    SET status=?, current_stage='story_engine', active_agent=?, updated_at=?
    WHERE run_id=?
  `).run(status, activeAgent, Date.now(), runId);
}

function applyAssistMode(db, run, requestedMode) {
  const mode = requestedMode || getOperatorAssistDefault(db).default_assist_mode;
  const profile = setWorkspaceAssist(db, run.workspace_id, { assist_mode: mode });

  if (profile.assist_mode === 'writer') {
    cancelQueuedDispatch(db, run.dispatch_id);
    setRunRoleState(db, run.run_id, 'writer_active', 'Human');
    recordAssistContribution(db, {
      workspace_id: run.workspace_id,
      source: 'human',
      action: 'writer_workspace_started',
      metadata: { assist_mode: 'writer', run_id: run.run_id }
    });
  } else if (profile.assist_mode === 'co_writer') {
    cancelQueuedDispatch(db, run.dispatch_id);
    setRunRoleState(db, run.run_id, 'co_writer_ready', 'Human + L99');
    recordAssistContribution(db, {
      workspace_id: run.workspace_id,
      source: 'shared',
      action: 'co_writer_workspace_started',
      metadata: { assist_mode: 'co_writer', run_id: run.run_id }
    });
  } else if (profile.assist_mode === 'director') {
    recordAssistContribution(db, {
      workspace_id: run.workspace_id,
      source: 'l99',
      action: 'director_draft_requested',
      metadata: { assist_mode: 'director', run_id: run.run_id, ghost_draft_status: run.ghost_plan?.draft?.status }
    });
  } else if (profile.assist_mode === 'autonomous_studio') {
    recordAssistContribution(db, {
      workspace_id: run.workspace_id,
      source: 'l99',
      action: 'autonomous_pipeline_started',
      metadata: { assist_mode: 'autonomous_studio', run_id: run.run_id, stop_at: 'release_gate', ghost_draft_status: run.ghost_plan?.draft?.status }
    });
  }

  log(db, {
    workspace_id: run.workspace_id,
    mode: 'assist_mode',
    event_type: `assist.role.${profile.assist_mode}.activated`,
    payload: {
      run_id: run.run_id,
      permissions: profile.permissions,
      ghost_commands: run.ghost_plan?.ghost_commands || []
    }
  });

  const roleState = {
    writer: { status: 'writer_active', current_stage: 'story_engine', active_agent: 'Human' },
    co_writer: { status: 'co_writer_ready', current_stage: 'story_engine', active_agent: 'Human + L99' },
    director: { status: run.status, current_stage: run.current_stage, active_agent: run.active_agent },
    autonomous_studio: { status: run.status, current_stage: run.current_stage, active_agent: run.active_agent }
  }[profile.assist_mode];

  return {
    ...run,
    ...roleState,
    assist_profile: profile
  };
}

export default function storyEngineRoutes(router, db) {
  router.get('/api/story-engine/options', (req, res) => {
    json(res, 200, {
      pipeline_stages: PIPELINE_STAGES,
      mediums: ['book', 'picture_book', 'movie', 'tv', 'song', 'podcast', 'game', 'comic', 'play', 'short_clip'],
      audiences: ['baby', 'child', 'eli5', 'eli10', 'middle_grade', 'teen', 'young_adult', 'adult'],
      story_kinds: ['adventure', 'fantasy', 'romance', 'mystery', 'horror', 'comedy', 'educational', 'science_fiction', 'historical', 'drama', 'thriller', 'other'],
      assist_modes: ASSIST_MODES,
      writing_providers: ['anthropic', 'openai', 'openrouter'],
      ghost_commands: storyEngineBrainSnapshot(db).ghost_commands
    });
  });

  router.post('/api/story-engine/intent', (req, res) => {
    try { json(res, 200, parseStoryIntent(req.body || {})); }
    catch (error) { json(res, 400, { error: error.message }); }
  });

  router.post('/api/story-engine/runs', async (req, res) => {
    try {
      const run = await startStoryEngineRun(db, req.body || {});
      json(res, 201, applyAssistMode(db, run, req.body?.assist_mode));
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/story-engine/runs', (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      json(res, 200, listStoryEngineRuns(db, Number(url.searchParams.get('limit') || 50)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/story-engine/brain', (req, res) => {
    try { json(res, 200, storyEngineBrainSnapshot(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/story-engine/runs/:run_id', async (req, res) => {
    try {
      const run = await getStoryEngineRun(db, req.params.run_id);
      if (!run) return json(res, 404, { error: 'Story Engine run not found.' });
      json(res, 200, run);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.post('/api/story-engine/runs/:run_id/approve', (req, res) => {
    try { json(res, 200, approveStoryEngineRun(db, req.params.run_id)); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });

  router.post('/api/story-engine/runs/:run_id/resume', async (req, res) => {
    try {
      const run = await getStoryEngineRun(db, req.params.run_id, { resume: true });
      if (!run) return json(res, 404, { error: 'Story Engine run not found.' });
      json(res, 200, run);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
