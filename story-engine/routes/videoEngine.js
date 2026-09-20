// routes/videoEngine.js

import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
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
import {
  getStoryVideoExport,
  getStoryVideoExportFile,
  renderStoryVideoExport
} from '../lib/videoExport.js';
import {
  assembleOpenVideoMaster,
  getOpenVideoRender,
  getOpenVideoRenderFile,
  listOpenVideoRenders,
  pollOpenVideoRender,
  probeOpenVideoRenderer,
  reviewOpenVideoRender,
  submitOpenVideoShot
} from '../lib/openVideoRenderer.js';

function openRenderStatus(error) {
  if (error?.code === 'OPEN_RENDER_JOB_NOT_FOUND' || error?.code === 'OPEN_RENDER_NOT_FOUND' || /not found/i.test(error?.message || '')) return 404;
  if (['OPEN_RENDER_PREVIEW_NOT_VALIDATED', 'OPEN_RENDER_SHOTS_NOT_APPROVED', 'OPEN_RENDER_REVIEW_NOT_READY'].includes(error?.code)) return 409;
  if (['OPEN_RENDER_COMPUTE_UNCONFIGURED', 'OPEN_RENDER_COMPUTE_UNREACHABLE', 'OPEN_RENDER_COMPUTE_TIMEOUT', 'OPEN_RENDER_MEDIA_TOOLING_UNAVAILABLE'].includes(error?.code)) return 503;
  if (['OPEN_RENDER_WORKFLOW_UNAVAILABLE', 'OPEN_RENDER_WORKFLOW_INVALID', 'OPEN_RENDER_MODEL_MANIFEST_INVALID', 'OPEN_RENDER_COMFYUI_NODES_MISSING', 'OPEN_RENDER_MODEL_FILES_MISSING', 'BLOCKED_LICENSE_REVIEW', 'BLOCKED_CANON_REFERENCE'].includes(error?.code)) return 422;
  return 400;
}

function openRenderError(res, error, fallback) {
  return json(res, openRenderStatus(error), {
    error: error?.failure_receipts?.[0]?.safe_message || error?.message || fallback,
    code: error?.code || 'OPEN_RENDER_FAILED',
    blockers: error?.blockers || null,
    failure_receipts: error?.failure_receipts || null,
    missing_shots: error?.missing_shots || null
  });
}

function mediaContentType(filename) {
  switch (extname(String(filename || '')).toLowerCase()) {
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.mkv': return 'video/x-matroska';
    default: return 'video/mp4';
  }
}

export default function videoEngineRoutes(router, db) {
  router.get('/api/video-engine/options', (req, res) => {
    json(res, 200, {
      ...VIDEO_ENGINE_OPTIONS,
      shot_editor: storyVideoShotEditorOptions(),
      render_router: {
        primary_lane: 'self_hosted_open_weight',
        paid_fallback_authoritative: false,
        vendor_credit_zero_blocking: false,
        continuity_cookie_authoritative: false,
        assembly_requires_human_film_qa: true
      }
    });
  });

  router.get('/api/video-engine/open-renderer/status', async (req, res) => {
    try { json(res, 200, await probeOpenVideoRenderer()); }
    catch { json(res, 200, { renderer: 'comfyui_wan22_ti2v_5b_v2', ready: false, primary_lane: 'self_hosted_open_weight', vendor_credit_required: false, blockers: [{ id: 'GPU-UNKNOWN', code: 'OPEN_RENDER_STATUS_UNKNOWN', reason: 'Renderer status could not be verified.' }], authority: 'none' }); }
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
    try { json(res, 201, createStoryVideoJob(db, req.body || {})); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
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
    } catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/video-engine/jobs/:job_id', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 200, job);
    } catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/video-engine/jobs/:job_id/open-renders', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 200, listOpenVideoRenders(db, req.params.job_id));
    } catch { json(res, 500, { error: 'Open-render evidence could not be read.' }); }
  });

  router.post('/api/video-engine/jobs/:job_id/shot-plan', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 200, updateStoryVideoShotPlan(db, req.params.job_id, req.body || {}));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : /immutable/i.test(error.message) ? 409 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.post('/api/video-engine/jobs/:job_id/validate', async (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const validated = await validateStoryVideoJob(db, req.params.job_id);
      json(res, validated.validation?.passed === true ? 200 : 422, validated);
    } catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });

  // Real footage is asynchronous. Submission returns quickly with a render receipt;
  // the browser polls the render instead of keeping a long provider request open.
  router.post('/api/video-engine/jobs/:job_id/open-render', async (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const shotId = String(req.body?.shot_id || '').trim();
      if (!shotId) return json(res, 400, { error: 'shot_id is required.' });
      const submitted = await submitOpenVideoShot(db, req.params.job_id, shotId, req.body || {});
      json(res, 202, submitted);
    } catch (error) { openRenderError(res, error, 'Open video render could not be submitted.'); }
  });

  router.get('/api/video-engine/open-renders/:render_id', async (req, res) => {
    try {
      const existing = getOpenVideoRender(db, req.params.render_id);
      if (!existing) return json(res, 404, { error: 'Open video render not found.' });
      if (!requireWorkspaceAccess(req, res, existing.workspace_id)) return;
      const item = ['complete', 'failed'].includes(existing.status)
        ? existing
        : await pollOpenVideoRender(db, req.params.render_id);
      json(res, 200, item);
    } catch (error) { openRenderError(res, error, 'Open video render status could not be verified.'); }
  });

  router.post('/api/video-engine/open-renders/:render_id/review', (req, res) => {
    try {
      const existing = getOpenVideoRender(db, req.params.render_id);
      if (!existing) return json(res, 404, { error: 'Open video render not found.' });
      if (!requireWorkspaceAccess(req, res, existing.workspace_id)) return;
      json(res, 200, reviewOpenVideoRender(db, req.params.render_id, req.body || {}));
    } catch (error) { openRenderError(res, error, 'Open video film review could not be saved.'); }
  });

  router.post('/api/video-engine/jobs/:job_id/open-assemble', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 201, assembleOpenVideoMaster(db, req.params.job_id));
    } catch (error) { openRenderError(res, error, 'Open video assembly could not complete.'); }
  });

  router.get('/api/video-engine/open-renders/:render_id/media', (req, res) => {
    try {
      const file = getOpenVideoRenderFile(db, req.params.render_id);
      if (!file) return json(res, 404, { error: 'Rendered video not found.' });
      if (!requireWorkspaceAccess(req, res, file.row.workspace_id)) return;
      const stat = statSync(file.path);
      res.writeHead(200, {
        'Content-Type': mediaContentType(file.filename),
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store'
      });
      createReadStream(file.path).pipe(res);
    } catch { json(res, 500, { error: 'Rendered video could not be read.' }); }
  });

  // Deterministic preview export remains separate from actual generative footage.
  router.post('/api/video-engine/jobs/:job_id/render', async (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      if (job.status === 'preview_validated' && job.blueprint?.production_contract?.playable_video_required === true) {
        return json(res, 409, {
          error: 'Live-action preview passed Playwright. Final delivery requires real playable footage; the self-hosted open-weight renderer is the primary lane and paid renderers are optional fallback only.',
          code: 'LIVE_ACTION_REAL_FOOTAGE_REQUIRED'
        });
      }
      const rendered = await renderStoryVideoExport(db, req.params.job_id, req.body || {});
      json(res, rendered.reused ? 200 : 201, rendered);
    } catch (error) {
      const status = error.code === 'FFMPEG_UNAVAILABLE' ? 503 : /not found/i.test(error.message) ? 404 : /must pass Playwright validation/i.test(error.message) ? 409 : 400;
      json(res, status, { error: error.message, code: error.code || null });
    }
  });

  router.get('/api/video-engine/exports/:export_id', (req, res) => {
    try {
      const item = getStoryVideoExport(db, req.params.export_id);
      if (!item) return json(res, 404, { error: 'Video export not found.' });
      if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
      json(res, 200, item);
    } catch (error) { json(res, 500, { error: error.message }); }
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
    } catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/workspaces/:workspace_id/video-jobs', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    try { json(res, 200, listStoryVideoJobs(db, req.params.workspace_id, Number(req.query.limit || 50))); }
    catch (error) { json(res, 500, { error: error.message }); }
  });
}