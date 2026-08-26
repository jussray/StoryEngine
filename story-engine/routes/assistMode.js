// routes/assistMode.js

import { json } from '../lib/miniRouter.js';
import { requireRole } from '../lib/securityContext.js';
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
        writer: 'Writer',
        co_writer: 'Co-Writer',
        director: 'Director',
        autonomous_studio: 'Autonomous Studio'
      },
      icons: {
        writer: '👤',
        co_writer: '✍️',
        director: '🤖',
        autonomous_studio: '🚀'
      },
      descriptions: {
        writer: 'I write everything. L99 supports me when I ask.',
        co_writer: 'We write together. Every proposed change still requires acceptance.',
        director: 'L99 drafts. I shape, redirect, and approve the work.',
        autonomous_studio: 'L99 runs the full pipeline until Release Gate, where I make the final decision.'
      },
      invariant: 'L99 never overwrites human text or releases work without explicit human authority.'
    });
  });

  // Creators may read the operator-selected default so the first-run flow can
  // choose its assist posture. Only an administrator may change that default.
  router.get('/api/control-room/operator/assist-default', (req, res) => {
    try { json(res, 200, getOperatorAssistDefault(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.put('/api/control-room/operator/assist-default', (req, res) => {
    requireRole('administrator')(req, res, () => {
      try { json(res, 200, setOperatorAssistDefault(db, req.body?.default_assist_mode)); }
      catch (error) { json(res, 400, { error: error.message }); }
    });
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
