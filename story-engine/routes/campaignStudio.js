// routes/campaignStudio.js

import { json } from '../lib/miniRouter.js';
import {
  CAMPAIGN_PLATFORMS,
  buildCampaignPack,
  listCampaignPacks,
  getCampaignPack,
  listCampaignClips,
  getCampaignClip,
  campaignStudioOverview
} from '../lib/campaignStudio.js';
import { attachCreditsToCampaign, buildVisualEndCredit } from '../lib/visualLineage.js';

export default function campaignStudioRoutes(router, db) {
  router.get('/api/campaign-studio/options', (req, res) => {
    json(res, 200, {
      platforms: CAMPAIGN_PLATFORMS,
      principle: 'Promote the same validated work and each of its versions with platform-native, canon-locked assets.',
      required_end_credit: 'Every rendered clip must end with the source-book title and exact platform/version lineage.'
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
      json(res, 200, attachCreditsToCampaign(campaign));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/campaign-studio/packs/:campaign_id/clips', (req, res) => {
    try {
      const campaign = getCampaignPack(db, req.params.campaign_id);
      if (!campaign) return json(res, 404, { error: 'Campaign Pack not found.' });
      json(res, 200, attachCreditsToCampaign(campaign).clips);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/campaign-studio/clips/:clip_id', (req, res) => {
    try {
      const clip = getCampaignClip(db, req.params.clip_id);
      if (!clip) return json(res, 404, { error: 'Campaign Clip not found.' });
      const endCredit = buildVisualEndCredit({
        title: clip.clip?.lineage?.source_title,
        blueprintId: clip.blueprint_id,
        sourceVersion: clip.source_version,
        platformVersion: clip.platform_version,
        productionPackId: clip.production_pack_id,
        campaignId: clip.campaign_id
      });
      json(res, 200, { ...clip, clip: { ...clip.clip, end_credit: endCredit } });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/campaign-studio/:workspace_id/packs', (req, res) => {
    try { json(res, 200, listCampaignPacks(db, req.params.workspace_id)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.post('/api/campaign-studio/:workspace_id/build', (req, res) => {
    try {
      const campaign = buildCampaignPack(db, req.params.workspace_id, req.body || {});
      json(res, 201, attachCreditsToCampaign(campaign, req.body || {}));
    }
    catch (error) { json(res, /not found/i.test(error.message) ? 404 : 400, { error: error.message }); }
  });
}
