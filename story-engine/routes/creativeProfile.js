// routes/creativeProfile.js

import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
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
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const profile = getCreativeProfile(db, workspace_id);
    if (!profile) return json(res, 404, { error: 'Creative Profile not found.' });
    json(res, 200, profile);
  });

  router.get('/api/creative-profile/:workspace_id/context', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const context = creativeProfileContext(db, workspace_id);
    if (!context) return json(res, 404, { error: 'Creative Profile not found.' });
    json(res, 200, context);
  });

  router.post('/api/creative-profile/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const profile = upsertCreativeProfile(db, workspace_id, req.body || {});
      json(res, 201, profile);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.put('/api/creative-profile/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const profile = upsertCreativeProfile(db, workspace_id, req.body || {});
      json(res, 200, profile);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });
}
