// routes/learning.js

import { json } from '../lib/miniRouter.js';
import {
  captureEpisodeFromIncident,
  completeEpisode,
  learnedRecoveries,
  listEpisodes,
  predictWorkspaceRisk
} from '../lib/learningEngine.js';
import { getIncident } from '../models/lindymodeModel.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';

export default function learningRoutes(router, db) {
  router.post('/api/ooda/episodes/from-incident/:incident_id', (req, res) => {
    const target = getIncident(db, req.params.incident_id);
    if (!target) return json(res, 404, { error: 'Incident not found' });
    if (!requireWorkspaceAccess(req, res, target.workspace_id)) return;

    const episode = captureEpisodeFromIncident(db, req.params.incident_id, req.body?.outcome || 'unknown');
    if (!episode) return json(res, 404, { error: 'Incident not found' });
    json(res, 201, episode);
  });

  router.post('/api/ooda/episodes/:episode_id/complete', (req, res) => {
    const target = db.prepare('SELECT workspace_id FROM ooda_episodes WHERE episode_id = ?').get(req.params.episode_id);
    if (!target) return json(res, 404, { error: 'Episode not found' });
    if (!requireWorkspaceAccess(req, res, target.workspace_id)) return;

    const episode = completeEpisode(
      db,
      req.params.episode_id,
      req.body?.outcome || 'success',
      req.body?.confidence_after ?? null
    );
    if (!episode) return json(res, 404, { error: 'Episode not found' });
    json(res, 200, episode);
  });

  router.get('/api/ooda/episodes/:workspace_id', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, listEpisodes(db, req.params.workspace_id, limit));
  });

  router.get('/api/ooda/learned-recoveries', (req, res) => {
    json(res, 200, learnedRecoveries(db, req.query.trigger_type || null, Math.min(Number(req.query.limit) || 20, 100)));
  });

  router.post('/api/ooda/predict/:workspace_id', (req, res) => {
    json(res, 200, predictWorkspaceRisk(db, req.params.workspace_id));
  });

  router.get('/api/ooda/risk-history/:workspace_id', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM ooda_risk_snapshots
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(req.params.workspace_id).map(row => ({
      ...row,
      prediction: JSON.parse(row.prediction_json || '{}')
    }));
    json(res, 200, rows);
  });
}
