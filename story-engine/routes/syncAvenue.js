import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { compileSyncAvenue, syncAvenueOptions } from '../lib/syncAvenue.js';

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
}
