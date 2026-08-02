// routes/videoEngine.js

import { json } from '../lib/miniRouter.js';
import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';
import {
  VIDEO_ENGINE_OPTIONS,
  createStoryVideoJob,
  getStoryVideoJob,
  listStoryVideoJobs,
  storyVideoEngineOverview,
  validateStoryVideoJob
} from '../lib/videoEngine.js';

export default function videoEngineRoutes(router, db) {
  router.get('/api/video-engine/options', (req, res) => {
    json(res, 200, VIDEO_ENGINE_OPTIONS);
  });

  router.get('/api/video-engine/control-room', (req, res) => {
    requireRole('administrator')(req, res, () => {
      try { json(res, 200, storyVideoEngineOverview(db)); }
      catch (error) { json(res, 500, { error: error.message }); }
    });
  });

  router.post('/api/video-engine/jobs', (req, res) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id is required.' });
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    try {
      json(res, 201, createStoryVideoJob(db, req.body || {}));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/video-engine/jobs/:job_id/html', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const artifact = db.prepare('SELECT html FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id);
      if (!artifact) return json(res, 404, { error: 'Video artifact not found.' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(artifact.html);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/video-engine/jobs/:job_id', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 200, job);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.post('/api/video-engine/jobs/:job_id/validate', async (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const validated = await validateStoryVideoJob(db, req.params.job_id);
      json(res, validated.status === 'validated' ? 200 : 422, validated);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/workspaces/:workspace_id/video-jobs', (req, res) => {
    try {
      json(res, 200, listStoryVideoJobs(db, req.params.workspace_id, Number(req.query.limit || 50)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
