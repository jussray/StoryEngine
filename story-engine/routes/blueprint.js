// routes/blueprint.js

import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import {
  BLUEPRINT_TARGETS,
  buildStoryBlueprint,
  getStoryBlueprint,
  convertBlueprint,
  listBlueprintConversions,
  getBlueprintContinuationOptions
} from '../lib/storyBlueprint.js';
import * as Story from '../models/storyModel.js';
import { canCreateDerivedWorkspace, derivedWorkspaceCreationDenial } from '../lib/workspaceCreationAuthority.js';

export default function blueprintRoutes(router, db) {
  router.get('/api/blueprints/options', (req, res) => {
    json(res, 200, {
      targets: BLUEPRINT_TARGETS,
      principle: 'A source work must pass Book → Lindymode Validation → OODA → Redteam Seed Check before conversions unlock.'
    });
  });

  router.get('/api/blueprints/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const blueprint = getStoryBlueprint(db, workspace_id) || buildStoryBlueprint(db, workspace_id);
      json(res, 200, blueprint);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.post('/api/blueprints/:workspace_id/build', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      json(res, 201, buildStoryBlueprint(db, workspace_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/blueprints/:workspace_id/continuation-options', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      json(res, 200, getBlueprintContinuationOptions(db, workspace_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/blueprints/:workspace_id/conversions', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const blueprint = getStoryBlueprint(db, workspace_id) || buildStoryBlueprint(db, workspace_id);
      json(res, 200, listBlueprintConversions(db, blueprint.blueprint_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.post('/api/blueprints/:workspace_id/convert', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const sourceStory = Story.get(db, workspace_id);
    if (!sourceStory) return json(res, 404, { error: 'Source workspace not found.' });
    if (!canCreateDerivedWorkspace(req.auth, sourceStory)) {
      return json(res, 403, { ...derivedWorkspaceCreationDenial(req.auth), request_id: req.request_id });
    }
    try {
      const target = req.body?.target_medium || req.body?.target;
      json(res, 201, convertBlueprint(db, workspace_id, target));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });
}
