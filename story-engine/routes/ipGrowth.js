// routes/ipGrowth.js

import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { evaluateIpGrowth, getLatestIpGrowth, listIpGrowthActions, startIpExpansion, ipGrowthOverview } from '../lib/ipGrowthEngine.js';
import * as Story from '../models/storyModel.js';
import { canCreateDerivedWorkspace, derivedWorkspaceCreationDenial } from '../lib/workspaceCreationAuthority.js';

export default function ipGrowthRoutes(router, db) {
  router.get('/api/ip-growth/overview', (req, res) => {
    try { json(res, 200, ipGrowthOverview(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/ip-growth/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const latest = getLatestIpGrowth(db, workspace_id);
      json(res, 200, latest || evaluateIpGrowth(db, workspace_id));
    } catch (error) {
      json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message });
    }
  });

  router.post('/api/ip-growth/:workspace_id/evaluate', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try { json(res, 201, evaluateIpGrowth(db, workspace_id)); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });

  router.get('/api/ip-growth/:workspace_id/actions', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try { json(res, 200, listIpGrowthActions(db, workspace_id)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.post('/api/ip-growth/:workspace_id/expand', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const sourceStory = Story.get(db, workspace_id);
    if (!sourceStory) return json(res, 404, { error: 'Source workspace not found.' });
    if (!canCreateDerivedWorkspace(req.auth, sourceStory)) {
      return json(res, 403, { ...derivedWorkspaceCreationDenial(req.auth), request_id: req.request_id });
    }
    try {
      const target = req.body?.target_medium || req.body?.target;
      json(res, 201, startIpExpansion(db, workspace_id, target));
    } catch (error) {
      json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message });
    }
  });
}
