// routes/missionControl.js

import { json } from '../lib/miniRouter.js';
import { getMissionControlSnapshot } from '../lib/missionControl.js';
import { enqueueRuntime, drainRuntimeQueue, listDispatchQueue, scanChangedWorkspaces } from '../lib/runtimeDispatcher.js';
import { runEventRetention } from '../lib/eventRetention.js';

export default function missionControlRoutes(router, db) {
  router.get('/api/mission-control/snapshot', (req, res) => {
    json(res, 200, getMissionControlSnapshot(db));
  });

  router.get('/api/runtime/dispatch-queue', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, listDispatchQueue(db, limit));
  });

  router.post('/api/runtime/dispatch/:workspace_id', (req, res) => {
    const item = enqueueRuntime(db, req.params.workspace_id, req.body?.trigger_type || 'manual_dispatch');
    if (!item) return json(res, 404, { error: 'Workspace not found' });
    json(res, item.deduplicated ? 200 : 201, item);
  });

  router.post('/api/runtime/drain', (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 5, 25);
    json(res, 200, { processed: drainRuntimeQueue(db, limit) });
  });

  router.post('/api/runtime/scan', (req, res) => {
    json(res, 200, { enqueued: scanChangedWorkspaces(db) });
  });

  router.post('/api/mission-control/retention/run', (req, res) => {
    try {
      json(res, 200, runEventRetention(db, {
        keepMs: req.body?.keep_ms ? Number(req.body.keep_ms) : undefined,
        limit: req.body?.limit ? Number(req.body.limit) : undefined,
        dryRun: Boolean(req.body?.dry_run)
      }));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
