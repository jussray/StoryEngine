// routes/ipSeed.js

import { json } from '../lib/miniRouter.js';
import { buildIpSeed, getOrBuildIpSeed, getIpSeed, listIpSeeds, ipSeedOverview, proposeSeedUpdate } from '../lib/ipSeedMemoryGraph.js';

export default function ipSeedRoutes(router, db) {
  router.get('/api/ip-seeds/overview', (req, res) => {
    try { json(res, 200, ipSeedOverview(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/ip-seeds', (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      json(res, 200, listIpSeeds(db, Number(url.searchParams.get('limit') || 25)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/ip-seeds/:workspace_id', (req, res) => {
    try {
      const seed = getIpSeed(db, req.params.workspace_id);
      if (!seed) return json(res, 404, { error: 'IP Seed not found.' });
      json(res, 200, seed);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.post('/api/ip-seeds/:workspace_id/build', (req, res) => {
    try { json(res, 201, buildIpSeed(db, req.params.workspace_id)); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });

  router.post('/api/ip-seeds/:workspace_id/ensure', (req, res) => {
    try { json(res, 200, getOrBuildIpSeed(db, req.params.workspace_id)); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });

  router.post('/api/ip-seeds/:workspace_id/propose-update', (req, res) => {
    try { json(res, 201, proposeSeedUpdate(db, req.params.workspace_id, req.body || {})); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });
}
