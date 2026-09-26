import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { createStoryVideoJob } from '../lib/videoEngine.js';
import {
  attachSyncAvenueToStoryVideoJob,
  compileSyncAvenue,
  syncAvenueOptions
} from '../lib/syncAvenue.js';
import { bindSyncAvenueRendererDirections } from '../lib/syncAvenueRendererBridge.js';

function failures(error) {
  return Array.isArray(error?.failures) ? error.failures : [];
}

export default function syncAvenueRoutes(router, db) {
  router.get('/api/video-engine/sync-avenue/options', (req, res) => {
    json(res, 200, syncAvenueOptions());
  });

  router.post('/api/video-engine/sync-avenue/compile', (req, res) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id is required.' });
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    try {
      const plan = compileSyncAvenue(req.body || {});
      json(res, plan.status === 'BLOCKED' ? 422 : 200, plan);
    } catch (error) {
      json(res, 400, { error: error.message, code: error.code || 'SYNC_AVENUE_COMPILE_FAILED', failures: failures(error) });
    }
  });

  // Registered before the legacy video-engine route so every new /MAKEVIDEO job
  // is reality-bound before it is returned to a caller. The underlying video job
  // remains the authoritative persistence object. Sync Avenue adds its world-state
  // receipts, then the renderer bridge embeds the causal contract into the existing
  // provider-neutral prompt without granting render or publication authority.
  router.post('/api/video-engine/jobs', (req, res) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) return json(res, 400, { error: 'workspace_id is required.' });
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    try {
      const created = createStoryVideoJob(db, req.body || {});
      const enriched = attachSyncAvenueToStoryVideoJob(db, created, req.body || {});
      const renderBound = bindSyncAvenueRendererDirections(db, enriched);
      json(res, 201, renderBound);
    } catch (error) {
      json(res, /not found/i.test(error.message) ? 404 : 400, {
        error: error.message,
        code: error.code || 'SYNC_AVENUE_VIDEO_JOB_FAILED',
        failures: failures(error)
      });
    }
  });
}
