// routes/missionControl.js

import { json } from '../lib/miniRouter.js';
import { getMissionControlSnapshot } from '../lib/missionControl.js';
import {
  enqueueRuntime,
  drainRuntimeQueue,
  getRuntimeDispatch,
  listDispatchQueue,
  processRuntimeDispatch,
  scanChangedWorkspaces
} from '../lib/runtimeDispatcher.js';
import { runEventRetention } from '../lib/eventRetention.js';
import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';

function administratorOnly(handler) {
  return (req, res) => requireRole('administrator')(req, res, () => handler(req, res));
}

export default function missionControlRoutes(router, db) {
  router.get('/api/mission-control/snapshot', administratorOnly((req, res) => {
    json(res, 200, getMissionControlSnapshot(db));
  }));

  router.get('/api/runtime/dispatch-queue', administratorOnly((req, res) => {
    const limit = Math.min(Number(req.query?.limit) || 100, 500);
    json(res, 200, listDispatchQueue(db, limit));
  }));

  router.post('/api/runtime/dispatch/:workspace_id', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    const item = enqueueRuntime(db, req.params.workspace_id, req.body?.trigger_type || 'manual_dispatch');
    if (!item) return json(res, 404, { error: 'Workspace not found' });
    json(res, item.deduplicated ? 200 : 201, item);
  });

  router.post('/api/runtime/dispatch/:dispatch_id/process', async (req, res) => {
    const item = getRuntimeDispatch(db, req.params.dispatch_id);
    if (!item) return json(res, 404, { error: 'Runtime dispatch not found' });
    if (!requireWorkspaceAccess(req, res, item.workspace_id)) return;
    try {
      const processed = await processRuntimeDispatch(db, item.dispatch_id);
      if (!processed) return json(res, 404, { error: 'Runtime dispatch not found' });
      json(res, processed.status === 'failed' ? 500 : 200, processed);
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/runtime/drain', administratorOnly(async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 5, 25);
    try {
      json(res, 200, { processed: await drainRuntimeQueue(db, limit) });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }));

  router.post('/api/runtime/scan', administratorOnly((req, res) => {
    json(res, 200, { enqueued: scanChangedWorkspaces(db) });
  }));

  router.post('/api/mission-control/retention/run', administratorOnly((req, res) => {
    try {
      json(res, 200, runEventRetention(db, {
        keepMs: req.body?.keep_ms ? Number(req.body.keep_ms) : undefined,
        limit: req.body?.limit ? Number(req.body.limit) : undefined,
        dryRun: Boolean(req.body?.dry_run)
      }));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  }));
}
