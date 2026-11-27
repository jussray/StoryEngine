// routes/imageEngine.js
// HTTP surface for the durable image engine. Every job read and every image
// byte goes through requireWorkspaceAccess on the job's own workspace — the
// serving route verifies workspace ownership before streaming (build law 4).

import { createReadStream, statSync } from 'node:fs';
import { json } from '../lib/miniRouter.js';
import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';
import {
  IMAGE_ENGINE_OPTIONS,
  createImageGenerationJob,
  getImageGenerationFile,
  getImageGenerationJob,
  getWorkspaceCover,
  imageEngineOverview,
  listImageGenerationJobs,
  pollImageGenerationJob,
  submitImageGenerationJob
} from '../lib/imageEngine.js';

function jobStatus(error) {
  if (/not found/i.test(error?.message || '')) return 404;
  if (error?.code === 'IMAGE_COST_CAP_EXCEEDED') return 422;
  return 400;
}

export default function imageEngineRoutes(router, db) {
  router.get('/api/image-engine/options', (req, res) => {
    json(res, 200, IMAGE_ENGINE_OPTIONS);
  });

  router.get('/api/image-engine/control-room', (req, res) => {
    requireRole('administrator')(req, res, () => {
      try { json(res, 200, imageEngineOverview(db)); }
      catch (error) { json(res, 500, { error: error.message }); }
    });
  });

  router.post('/api/image-engine/jobs', async (req, res) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id is required.' });
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    try {
      const created = createImageGenerationJob(db, req.body || {});
      if (req.body?.submit === true && !created.reused) {
        const submitted = await submitImageGenerationJob(db, created.job_id);
        return json(res, 201, submitted);
      }
      json(res, created.reused ? 200 : 201, created);
    } catch (error) {
      json(res, jobStatus(error), { error: error.message, code: error.code || null });
    }
  });

  router.post('/api/image-engine/jobs/:job_id/submit', async (req, res) => {
    try {
      const job = getImageGenerationJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Image job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      const submitted = await submitImageGenerationJob(db, req.params.job_id);
      json(res, submitted.status === 'provider_unconfigured' ? 503 : 202, submitted);
    } catch (error) { json(res, jobStatus(error), { error: error.message, code: error.code || null }); }
  });

  router.get('/api/image-engine/jobs/:job_id', async (req, res) => {
    try {
      let job = getImageGenerationJob(db, req.params.job_id);
      if (!job) return json(res, 404, { error: 'Image job not found.' });
      if (!requireWorkspaceAccess(req, res, job.workspace_id)) return;
      // In-flight jobs advance by polling the SAME persisted prediction —
      // the open-renderer read pattern. Polling never creates a prediction.
      if (job.provider_prediction_id && ['processing', 'copy_failed'].includes(job.status)) {
        job = await pollImageGenerationJob(db, req.params.job_id);
      }
      json(res, 200, job);
    } catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/image-engine/jobs/:job_id/image', (req, res) => {
    try {
      const file = getImageGenerationFile(db, req.params.job_id);
      if (!file) return json(res, 404, { error: 'Generated image not found.' });
      if (!requireWorkspaceAccess(req, res, file.job.workspace_id)) return;
      const stat = statSync(file.path);
      res.writeHead(200, {
        'Content-Type': file.content_type,
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store'
      });
      createReadStream(file.path).pipe(res);
    } catch { json(res, 500, { error: 'Generated image could not be read.' }); }
  });

  router.get('/api/workspaces/:workspace_id/image-jobs', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    try { json(res, 200, listImageGenerationJobs(db, req.params.workspace_id, Number(req.query.limit || 50))); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  // The book's current cover: the latest succeeded cover job, or null. A
  // book without a cover is a normal state — cover presence never gates the
  // book's own release validation (build law 4).
  router.get('/api/workspaces/:workspace_id/cover', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    try { json(res, 200, { workspace_id: req.params.workspace_id, cover: getWorkspaceCover(db, req.params.workspace_id) }); }
    catch (error) { json(res, 500, { error: error.message }); }
  });
}
