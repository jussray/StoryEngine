// routes/videoEngine.js

import { createReadStream } from 'node:fs';
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
import {
  storyVideoShotEditorOptions,
  updateStoryVideoShotPlan
} from '../lib/videoShotPlanEditor.js';
import { ensureStoryVideoContinuityGate } from '../lib/videoContinuity.js';
import {
  getStoryVideoExport,
  getStoryVideoExportFile,
  renderStoryVideoExport
} from '../lib/videoExport.js';
import {
  VIDEO_COMPOSITION_PROFILES,
  composeStoryVideoExports,
  getStoryVideoComposition,
  getStoryVideoCompositionFile
} from '../lib/videoComposition.js';

function publicFailures(error) {
  return Array.isArray(error?.failures) ? error.failures : [];
}

export default function videoEngineRoutes(router, db) {
  router.get('/api/video-engine/options', (req, res) => {
    json(res, 200, {
      ...VIDEO_ENGINE_OPTIONS,
      shot_editor: storyVideoShotEditorOptions(),
      composition_profiles: VIDEO_COMPOSITION_PROFILES
    });
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
      json(res, status, { error: error.message, code: error.code || null, failures: publicFailures(error) });
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

  router.post('/api/video-engine/jobs/:job_id/shot-plan', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 200, updateStoryVideoShotPlan(db, req.params.job_id, req.body || {}));
    } catch (error) {
      const status = /not found/i.test(error.message)
        ? 404
        : /immutable/i.test(error.message)
          ? 409
          : 400;
      json(res, status, { error: error.message, code: error.code || null, failures: publicFailures(error) });
    }
  });

  router.post('/api/video-engine/jobs/:job_id/validate', async (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const validated = await validateStoryVideoJob(db, req.params.job_id);
      json(res, validated.validation?.passed === true ? 200 : 422, validated);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message, code: error.code || null, failures: publicFailures(error) });
    }
  });

  router.post('/api/video-engine/jobs/:job_id/render', async (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      if (job.status === 'preview_validated' && job.blueprint?.production_contract?.playable_video_required === true) {
        return json(res, 409, {
          error: 'Live-action preview passed Playwright; final delivery requires a playable provider-rendered video.',
          code: 'LIVE_ACTION_PROVIDER_REQUIRED'
        });
      }
      ensureStoryVideoContinuityGate(db, req.params.job_id);
      const rendered = await renderStoryVideoExport(db, req.params.job_id, req.body || {});
      json(res, rendered.reused ? 200 : 201, rendered);
    } catch (error) {
      const status = error.code === 'FFMPEG_UNAVAILABLE'
        ? 503
        : /not found/i.test(error.message)
          ? 404
          : /must pass Playwright validation/i.test(error.message)
            ? 409
            : error.code === 'SHOT_CONTINUITY_CONTRACT_BLOCKED'
              ? 409
              : 400;
      json(res, status, { error: error.message, code: error.code || null, failures: publicFailures(error) });
    }
  });

  router.post('/api/video-engine/compositions', async (req, res) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id is required.', code: 'COMPOSITION_WORKSPACE_REQUIRED' });
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    try {
      const composition = await composeStoryVideoExports(db, req.body || {});
      json(res, composition.reused ? 200 : 201, composition);
    } catch (error) {
      const status = error.code === 'FFMPEG_UNAVAILABLE'
        ? 503
        : error.code === 'COMPOSITION_SOURCE_MISSING'
          ? 404
          : [
              'COMPOSITION_SOURCE_NOT_READY',
              'COMPOSITION_WORKSPACE_MISMATCH',
              'COMPOSITION_SOURCE_HASH_MISMATCH',
              'COMPOSITION_SOURCE_UNVERIFIED',
              'COMPOSITION_INCOMPATIBLE_EXPORTS'
            ].includes(error.code)
            ? 409
            : 400;
      json(res, status, { error: error.message, code: error.code || null, failures: publicFailures(error) });
    }
  });

  router.get('/api/video-engine/compositions/:composition_id', (req, res) => {
    try {
      const item = getStoryVideoComposition(db, req.params.composition_id);
      if (!item) return json(res, 404, { error: 'Video composition not found.' });
      if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
      json(res, 200, item);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/video-engine/compositions/:composition_id/mp4', (req, res) => {
    try {
      const item = getStoryVideoComposition(db, req.params.composition_id);
      if (!item) return json(res, 404, { error: 'Video composition not found.' });
      if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
      const file = getStoryVideoCompositionFile(db, req.params.composition_id);
      if (!file) return json(res, 404, { error: 'Video composition file not found.' });
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(file.composition.byte_size),
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store'
      });
      createReadStream(file.path).pipe(res);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/video-engine/exports/:export_id', (req, res) => {
    try {
      const item = getStoryVideoExport(db, req.params.export_id);
      if (!item) return json(res, 404, { error: 'Video export not found.' });
      if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
      json(res, 200, item);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/video-engine/exports/:export_id/mp4', (req, res) => {
    try {
      const item = getStoryVideoExport(db, req.params.export_id);
      if (!item) return json(res, 404, { error: 'Video export not found.' });
      if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
      const file = getStoryVideoExportFile(db, req.params.export_id);
      if (!file) return json(res, 404, { error: 'Video export file not found.' });
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(file.export.byte_size),
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store'
      });
      createReadStream(file.path).pipe(res);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/workspaces/:workspace_id/video-jobs', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    try {
      json(res, 200, listStoryVideoJobs(db, req.params.workspace_id, Number(req.query.limit || 50)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
