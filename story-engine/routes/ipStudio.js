// routes/ipStudio.js

import { json } from '../lib/miniRouter.js';
import { IP_STUDIO_PACK_TYPES, buildProductionPack, listProductionPacks, getProductionPack, ipStudioOverview } from '../lib/ipStudio.js';

export default function ipStudioRoutes(router, db) {
  router.get('/api/ip-studio/options', (req, res) => {
    json(res, 200, {
      targets: IP_STUDIO_PACK_TYPES,
      principle: 'Build visual and script production packs from a validated seed and keep every asset traceable to the same IP lineage.'
    });
  });

  router.get('/api/ip-studio/overview', (req, res) => {
    try { json(res, 200, ipStudioOverview(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/ip-studio/packs/:pack_id', (req, res) => {
    try {
      const pack = getProductionPack(db, req.params.pack_id);
      if (!pack) return json(res, 404, { error: 'Production Pack not found.' });
      json(res, 200, pack);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/ip-studio/:workspace_id/production-packs', (req, res) => {
    try { json(res, 200, listProductionPacks(db, req.params.workspace_id)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.post('/api/ip-studio/:workspace_id/production-pack', (req, res) => {
    try { json(res, 201, buildProductionPack(db, req.params.workspace_id, req.body || {})); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });
}
