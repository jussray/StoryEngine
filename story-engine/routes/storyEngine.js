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
  getOperatorAssistDefault,
  setWorkspaceAssist,
  recordAssistContribution
} from '../lib/assistMode.js';
import { log } from '../models/eventModel.js';

function applyAssistMode(db, run, requestedMode) {
  const assistMode = requestedMode || getOperatorAssistDefault(db).default_assist_mode;
  const profile = setWorkspaceAssist(db, run.workspace_id, { assist_mode: assistMode });

  if (profile.assist_mode === 'human_first' && run.dispatch_id) {
    db.prepare(`
      UPDATE runtime_dispatch_queue
      SET status='cancelled', updated_at=?
      WHERE dispatch_id=? AND status='queued'
    `).run(Date.now(), run.dispatch_id);
    db.prepare(`
      UPDATE story_engine_runs
      SET status='human_writing', current_stage='story_engine', active_agent='Human', updated_at=?
      WHERE run_id=?
    `).run(Date.now(), run.run_id);
    recordAssistContribution(db, {
      workspace_id: run.workspace_id,
      source: 'human',
      action: 'workspace_started',
      metadata: { assist_mode: 'human_first', run_id: run.run_id }
    });
    log(db, {
      workspace_id: run.workspace_id,
      mode: 'assist_mode',
      event_type: 'assist.human_first.ready',
      payload: {
        run_id: run.run_id,
        rule: 'L99 may suggest and analyze but may not draft or overwrite without request and acceptance.'
      }
    });
  } else if (profile.assist_mode === 'system_first') {
    recordAssistContribution(db, {
      workspace_id: run.workspace_id,
      source: 'l99',
      action: 'draft_requested',
      metadata: { assist_mode: 'system_first', run_id: run.run_id }
    });
  }

  return { ...run, assist_profile: profile, status: profile.assist_mode === 'human_first' ? 'human_writing' : run.status, current_stage: profile.assist_mode === 'human_first' ? 'story_engine' : run.current_stage, active_agent: profile.assist_mode === 'human_first' ? 'Human' : run.active_agent };
}

export default function storyEngineRoutes(router, db) {
  router.get('/api/story-engine/options', (req, res) => {
    json(res, 200, {
      pipeline_stages: PIPELINE_STAGES,
      mediums: ['book', 'picture_book', 'movie', 'tv', 'song', 'podcast', 'game', 'comic', 'play', 'short_clip'],
      audiences: ['baby', 'child', 'eli5', 'eli10', 'middle_grade', 'teen', 'young_adult', 'adult'],
      story_kinds: ['adventure', 'fantasy', 'romance', 'mystery', 'horror', 'comedy', 'educational', 'science_fiction', 'historical', 'drama', 'thriller', 'other'],
      assist_modes: ['human_first', 'system_first']
    });
  });

  router.post('/api/story-engine/intent', (req, res) => {
    try {
      json(res, 200, parseStoryIntent(req.body || {}));
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.post('/api/story-engine/runs', (req, res) => {
    try {
      const run = startStoryEngineRun(db, req.body || {});
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
    try {
      json(res, 200, storyEngineBrainSnapshot(db));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
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
    try {
      json(res, 200, approveStoryEngineRun(db, req.params.run_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
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
