// routes/ipGrowth.js

import { json } from '../lib/miniRouter.js';
import { evaluateIpGrowth, getLatestIpGrowth, listIpGrowthActions, startIpExpansion, ipGrowthOverview } from '../lib/ipGrowthEngine.js';

export default function ipGrowthRoutes(router, db) {
  router.get('/api/ip-growth/overview', (req, res) => {
    try { json(res, 200, ipGrowthOverview(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/ip-growth/:workspace_id', (req, res) => {
    try {
      const latest = getLatestIpGrowth(db, req.params.workspace_id);
      json(res, 200, latest || evaluateIpGrowth(db, req.params.workspace_id));
    } catch (error) {
      json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message });
    }
  });

  router.post('/api/ip-growth/:workspace_id/evaluate', (req, res) => {
    try { json(res, 201, evaluateIpGrowth(db, req.params.workspace_id)); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });

  router.get('/api/ip-growth/:workspace_id/actions', (req, res) => {
    try { json(res, 200, listIpGrowthActions(db, req.params.workspace_id)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.post('/api/ip-growth/:workspace_id/expand', (req, res) => {
    try {
      const target = req.body?.target_medium || req.body?.target;
      json(res, 201, startIpExpansion(db, req.params.workspace_id, target));
    } catch (error) {
      json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message });
    }
  });
}
