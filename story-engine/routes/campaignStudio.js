// routes/campaignStudio.js

import { json } from '../lib/miniRouter.js';
import { CAMPAIGN_PLATFORMS, buildCampaignPack, listCampaignPacks, getCampaignPack, campaignStudioOverview } from '../lib/campaignStudio.js';

export default function campaignStudioRoutes(router, db) {
  router.get('/api/campaign-studio/options', (req, res) => {
    json(res, 200, {
      platforms: CAMPAIGN_PLATFORMS,
      principle: 'Promote the same validated work and each of its versions with platform-native, canon-locked assets.'
    });
  });

  router.get('/api/campaign-studio/overview', (req, res) => {
    try { json(res, 200, campaignStudioOverview(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.get('/api/campaign-studio/packs/:campaign_id', (req, res) => {
    try {
      const campaign = getCampaignPack(db, req.params.campaign_id);
      if (!campaign) return json(res, 404, { error: 'Campaign Pack not found.' });
      json(res, 200, campaign);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/campaign-studio/:workspace_id/packs', (req, res) => {
    try { json(res, 200, listCampaignPacks(db, req.params.workspace_id)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.post('/api/campaign-studio/:workspace_id/build', (req, res) => {
    try { json(res, 201, buildCampaignPack(db, req.params.workspace_id, req.body || {})); }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });
}
