// routes/assistMode.js

import { json } from '../lib/miniRouter.js';
import {
  ASSIST_MODES,
  getOperatorAssistDefault,
  setOperatorAssistDefault,
  getWorkspaceAssist,
  setWorkspaceAssist,
  recordAssistContribution,
  listAssistContributions
} from '../lib/assistMode.js';

export default function assistModeRoutes(router, db) {
  router.get('/api/assist/options', (req, res) => {
    json(res, 200, {
      modes: ASSIST_MODES,
      labels: {
        human_first: 'Write it myself',
        system_first: 'Have L99 draft it'
      },
      descriptions: {
        human_first: 'L99 watches for continuity, gives suggestions, and lets you lead.',
        system_first: 'L99 writes a draft, and you shape and approve the final story.'
      },
      invariant: 'L99 never overwrites human text without explicit acceptance.'
    });
  });

  router.get('/api/control-room/operator/assist-default', (req, res) => {
    try { json(res, 200, getOperatorAssistDefault(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.put('/api/control-room/operator/assist-default', (req, res) => {
    try { json(res, 200, setOperatorAssistDefault(db, req.body?.default_assist_mode)); }
    catch (error) { json(res, 400, { error: error.message }); }
  });

  router.get('/api/workspaces/:workspace_id/assist', (req, res) => {
    try { json(res, 200, getWorkspaceAssist(db, req.params.workspace_id)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.put('/api/workspaces/:workspace_id/assist', (req, res) => {
    try { json(res, 200, setWorkspaceAssist(db, req.params.workspace_id, req.body || {})); }
    catch (error) { json(res, 400, { error: error.message }); }
  });

  router.get('/api/workspaces/:workspace_id/assist/contributions', (req, res) => {
    try {
      json(res, 200, listAssistContributions(db, req.params.workspace_id, Number(req.query.limit || 100)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.post('/api/workspaces/:workspace_id/assist/contributions', (req, res) => {
    try {
      json(res, 201, recordAssistContribution(db, {
        ...(req.body || {}),
        workspace_id: req.params.workspace_id
      }));
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });
}
