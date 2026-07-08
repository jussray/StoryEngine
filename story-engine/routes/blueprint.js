// routes/blueprint.js

import { json } from '../lib/miniRouter.js';
import {
  BLUEPRINT_TARGETS,
  buildStoryBlueprint,
  getStoryBlueprint,
  convertBlueprint,
  listBlueprintConversions,
  getBlueprintContinuationOptions
} from '../lib/storyBlueprint.js';

export default function blueprintRoutes(router, db) {
  router.get('/api/blueprints/options', (req, res) => {
    json(res, 200, {
      targets: BLUEPRINT_TARGETS,
      principle: 'A source work must pass Book → Lindymode Validation → OODA → Redteam Seed Check before conversions unlock.'
    });
  });

  router.get('/api/blueprints/:workspace_id', (req, res) => {
    try {
      const blueprint = getStoryBlueprint(db, req.params.workspace_id) || buildStoryBlueprint(db, req.params.workspace_id);
      json(res, 200, blueprint);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.post('/api/blueprints/:workspace_id/build', (req, res) => {
    try {
      json(res, 201, buildStoryBlueprint(db, req.params.workspace_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/blueprints/:workspace_id/continuation-options', (req, res) => {
    try {
      json(res, 200, getBlueprintContinuationOptions(db, req.params.workspace_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/blueprints/:workspace_id/conversions', (req, res) => {
    try {
      const blueprint = getStoryBlueprint(db, req.params.workspace_id) || buildStoryBlueprint(db, req.params.workspace_id);
      json(res, 200, listBlueprintConversions(db, blueprint.blueprint_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.post('/api/blueprints/:workspace_id/convert', (req, res) => {
    try {
      const target = req.body?.target_medium || req.body?.target;
      json(res, 201, convertBlueprint(db, req.params.workspace_id, target));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });
}
