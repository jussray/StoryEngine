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
import { ensureStoryVideoContinuityGate } from '../lib/videoContinuity.js';
import {
  getStoryVideoExport,
  getStoryVideoExportFile,
  renderStoryVideoExport
} from '../lib/videoExport.js';
import {
  VIDEO_COMPOSITION_PROFILES,
  composeStoryVideoSources,
  getStoryVideoComposition,
  getStoryVideoCompositionFile
} from '../lib/videoComposition.js';
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
import {
  acquireRenderLease,
  attachRenderLedger,
  beginRenderAttempt,
  recordMasterAssembly,
  recordRenderAttemptFailure,
  recordRenderReview,
  recordRenderSubmission,
  releaseRenderLease
} from '../lib/videoRenderLedger.js';

function publicFailures(error) {
  return Array.isArray(error?.failures) ? error.failures : [];
}

function openRenderStatus(error) {
  if (error?.code === 'OPEN_RENDER_JOB_NOT_FOUND' || error?.code === 'OPEN_RENDER_NOT_FOUND' || /not found/i.test(error?.message || '')) return 404;
  if (['OPEN_RENDER_PREVIEW_NOT_VALIDATED', 'OPEN_RENDER_SHOTS_NOT_APPROVED', 'OPEN_RENDER_REVIEW_NOT_READY', 'SHOT_CONTINUITY_CONTRACT_BLOCKED'].includes(error?.code)) return 409;
  if (['OPEN_RENDER_COMPUTE_UNCONFIGURED', 'OPEN_RENDER_COMPUTE_UNREACHABLE', 'OPEN_RENDER_COMPUTE_TIMEOUT', 'OPEN_RENDER_MEDIA_TOOLING_UNAVAILABLE'].includes(error?.code)) return 503;
  if (['OPEN_RENDER_WORKFLOW_UNAVAILABLE', 'OPEN_RENDER_WORKFLOW_INVALID', 'OPEN_RENDER_MODEL_MANIFEST_INVALID', 'OPEN_RENDER_COMFYUI_NODES_MISSING', 'OPEN_RENDER_MODEL_FILES_MISSING', 'BLOCKED_LICENSE_REVIEW', 'BLOCKED_CANON_REFERENCE'].includes(error?.code)) return 422;
  return 400;
}

function openRenderError(res, error, fallback) {
  return json(res, openRenderStatus(error), {
    error: error?.failure_receipts?.[0]?.safe_message || error?.message || fallback,
    code: error?.code || 'OPEN_RENDER_FAILED',
    blockers: error?.blockers || null,
    failures: publicFailures(error),
    failure_receipts: error?.failure_receipts || null,
    missing_shots: error?.missing_shots || null
  });
}

function compositionStatus(error) {
  if (error?.code === 'FFMPEG_UNAVAILABLE') return 503;
  if (error?.code === 'COMPOSITION_SOURCE_MISSING') return 404;
  if ([
    'COMPOSITION_SOURCE_NOT_READY',
    'COMPOSITION_WORKSPACE_MISMATCH',
    'COMPOSITION_SOURCE_HASH_MISMATCH',
    'COMPOSITION_SOURCE_UNVERIFIED',
    'COMPOSITION_SOURCE_STALE',
    'COMPOSITION_SOURCE_NOT_APPROVED',
    'COMPOSITION_INCOMPATIBLE_EXPORTS'
  ].includes(error?.code)) return 409;
  return 400;
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
      composition_profiles: VIDEO_COMPOSITION_PROFILES,
      render_router: {
        primary_lane: 'self_hosted_open_weight',
        paid_fallback_authoritative: false,
        vendor_credit_zero_blocking: false,
        continuity_cookie_authoritative: false,
        assembly_requires_human_film_qa: true,
        length_strategy: 'verified_atomic_clips_then_ordered_composition'
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
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message, code: error.code || null, failures: publicFailures(error) }); }
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
      const result = listOpenVideoRenders(db, req.params.job_id);
      if (result?.renders) result.renders = result.renders.map(render => attachRenderLedger(db, render));
      json(res, 200, result);
    } catch { json(res, 500, { error: 'Open-render evidence could not be read.' }); }
  });

  router.post('/api/video-engine/jobs/:job_id/shot-plan', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      json(res, 200, updateStoryVideoShotPlan(db, req.params.job_id, req.body || {}));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : /immutable/i.test(error.message) || error.code === 'SHOT_CONTINUITY_CONTRACT_BLOCKED' ? 409 : 400;
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
    } catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message, code: error.code || null, failures: publicFailures(error) }); }
  });

  router.post('/api/video-engine/jobs/:job_id/open-render', async (req, res) => {
    let attempt = null;
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const shotId = String(req.body?.shot_id || '').trim();
      if (!shotId) return json(res, 400, { error: 'shot_id is required.' });
      ensureStoryVideoContinuityGate(db, req.params.job_id);
      attempt = beginRenderAttempt(db, { job, shot_id: shotId, input: req.body || {} });
      const submitted = await submitOpenVideoShot(db, req.params.job_id, shotId, req.body || {});
      recordRenderSubmission(db, attempt.attempt_id, submitted);
      json(res, 202, attachRenderLedger(db, submitted));
    } catch (error) {
      if (attempt?.attempt_id) recordRenderAttemptFailure(db, attempt.attempt_id, error);
      openRenderError(res, error, 'Open video render could not be submitted.');
    }
  });

  router.get('/api/video-engine/open-renders/:render_id', async (req, res) => {
    let lease = null;
    try {
      const existing = getOpenVideoRender(db, req.params.render_id);
      if (!existing) return json(res, 404, { error: 'Open video render not found.' });
      if (!requireWorkspaceAccess(req, res, existing.workspace_id)) return;
      let item = existing;
      if (!['complete', 'failed'].includes(existing.status)) {
        lease = acquireRenderLease(db, existing);
        if (lease.acquired) item = await pollOpenVideoRender(db, req.params.render_id);
      }
      json(res, 200, attachRenderLedger(db, item));
    } catch (error) {
      openRenderError(res, error, 'Open video render status could not be verified.');
    } finally {
      if (lease?.acquired && lease?.lease?.lease_id) releaseRenderLease(db, req.params.render_id, lease.lease.lease_id);
    }
  });

  router.post('/api/video-engine/open-renders/:render_id/review', (req, res) => {
    try {
      const existing = getOpenVideoRender(db, req.params.render_id);
      if (!existing) return json(res, 404, { error: 'Open video render not found.' });
      if (!requireWorkspaceAccess(req, res, existing.workspace_id)) return;
      const reviewed = reviewOpenVideoRender(db, req.params.render_id, req.body || {});
      recordRenderReview(db, reviewed);
      json(res, 200, attachRenderLedger(db, reviewed));
    } catch (error) { openRenderError(res, error, 'Open video film review could not be saved.'); }
  });

  router.post('/api/video-engine/jobs/:job_id/open-assemble', (req, res) => {
    try {
      const job = getStoryVideoJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Video job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      ensureStoryVideoContinuityGate(db, req.params.job_id);
      const assembled = assembleOpenVideoMaster(db, req.params.job_id);
      const ledger = recordMasterAssembly(db, assembled);
      json(res, 201, { ...assembled, ledger });
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
      ensureStoryVideoContinuityGate(db, req.params.job_id);
      const rendered = await renderStoryVideoExport(db, req.params.job_id, req.body || {});
      json(res, rendered.reused ? 200 : 201, rendered);
    } catch (error) {
      const status = error.code === 'FFMPEG_UNAVAILABLE' ? 503 : /not found/i.test(error.message) ? 404 : /must pass Playwright validation/i.test(error.message) || error.code === 'SHOT_CONTINUITY_CONTRACT_BLOCKED' ? 409 : 400;
      json(res, status, { error: error.message, code: error.code || null, failures: publicFailures(error) });
    }
  });

  router.post('/api/video-engine/compositions', async (req, res) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id is required.', code: 'COMPOSITION_WORKSPACE_REQUIRED' });
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    try {
      const composition = await composeStoryVideoSources(db, req.body || {});
      json(res, composition.reused ? 200 : 201, composition);
    } catch (error) {
      json(res, compositionStatus(error), { error: error.message, code: error.code || 'COMPOSITION_FAILED', failures: publicFailures(error) });
    }
  });

  router.get('/api/video-engine/compositions/:composition_id', (req, res) => {
    try {
      const item = getStoryVideoComposition(db, req.params.composition_id);
      if (!item) return json(res, 404, { error: 'Video composition not found.' });
      if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
      json(res, 200, item);
    } catch { json(res, 500, { error: 'Video composition could not be read.' }); }
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
    } catch { json(res, 500, { error: 'Video composition file could not be read.' }); }
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
