// routes/creativeProfile.js

import { json } from '../lib/miniRouter.js';
import {
  CREATIVE_PROFILE_OPTIONS,
  getCreativeProfile,
  upsertCreativeProfile,
  creativeProfileContext
} from '../lib/creativeProfile.js';

export default function creativeProfileRoutes(router, db) {
  router.get('/api/creative-profile/options', (req, res) => {
    json(res, 200, CREATIVE_PROFILE_OPTIONS);
  });

  router.get('/api/creative-profile/:workspace_id', (req, res) => {
    const profile = getCreativeProfile(db, req.params.workspace_id);
    if (!profile) return json(res, 404, { error: 'Creative Profile not found.' });
    json(res, 200, profile);
  });

  router.get('/api/creative-profile/:workspace_id/context', (req, res) => {
    const context = creativeProfileContext(db, req.params.workspace_id);
    if (!context) return json(res, 404, { error: 'Creative Profile not found.' });
    json(res, 200, context);
  });

  router.post('/api/creative-profile/:workspace_id', (req, res) => {
    try {
      const profile = upsertCreativeProfile(db, req.params.workspace_id, req.body || {});
      json(res, 201, profile);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.put('/api/creative-profile/:workspace_id', (req, res) => {
    try {
      const profile = upsertCreativeProfile(db, req.params.workspace_id, req.body || {});
      json(res, 200, profile);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });
}
