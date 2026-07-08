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

export default function storyEngineRoutes(router, db) {
  router.get('/api/story-engine/options', (req, res) => {
    json(res, 200, {
      pipeline_stages: PIPELINE_STAGES,
      mediums: ['book', 'picture_book', 'movie', 'tv', 'song', 'podcast', 'game', 'comic', 'play', 'short_clip'],
      audiences: ['baby', 'child', 'eli5', 'eli10', 'middle_grade', 'teen', 'young_adult', 'adult'],
      story_kinds: ['adventure', 'fantasy', 'romance', 'mystery', 'horror', 'comedy', 'educational', 'science_fiction', 'historical', 'drama', 'thriller', 'other']
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
      json(res, 201, startStoryEngineRun(db, req.body || {}));
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

  router.get('/api/story-engine/runs/:run_id', (req, res) => {
    try {
      const run = getStoryEngineRun(db, req.params.run_id);
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

  router.post('/api/story-engine/runs/:run_id/resume', (req, res) => {
    try {
      const run = getStoryEngineRun(db, req.params.run_id, { resume: true });
      if (!run) return json(res, 404, { error: 'Story Engine run not found.' });
      json(res, 200, run);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
