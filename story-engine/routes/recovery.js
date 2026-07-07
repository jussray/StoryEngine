// routes/recovery.js

import { json } from '../lib/miniRouter.js';
import { planRecovery, runRecovery, getRecoveryRun, listRecoveryRuns } from '../lib/recoveryEngine.js';
import { buildStoryGenome, getStoryGenome } from '../lib/storyGenome.js';

export default function recoveryRoutes(router, db) {
  router.get('/api/ooda/recovery-plan/:incident_id', (req, res) => {
    const plan = planRecovery(db, req.params.incident_id);
    if (!plan) return json(res, 404, { error: 'Incident not found' });
    json(res, 200, plan);
  });

  router.post('/api/ooda/recover/:incident_id', (req, res) => {
    try {
      const run = runRecovery(db, req.params.incident_id, req.body?.strategy || null);
      if (!run) return json(res, 404, { error: 'Incident not found' });
      json(res, run.status === 'validated' ? 200 : 202, run);
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/ooda/recovery-run/:run_id', (req, res) => {
    const run = getRecoveryRun(db, req.params.run_id);
    if (!run) return json(res, 404, { error: 'Recovery run not found' });
    json(res, 200, run);
  });

  router.get('/api/ooda/recovery-runs/:workspace_id', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, listRecoveryRuns(db, req.params.workspace_id, limit));
  });

  router.post('/api/story-genome/:workspace_id/refresh', (req, res) => {
    const genome = buildStoryGenome(db, req.params.workspace_id);
    if (!genome) return json(res, 404, { error: 'Workspace not found' });
    json(res, 200, genome);
  });

  router.get('/api/story-genome/:workspace_id', (req, res) => {
    const genome = getStoryGenome(db, req.params.workspace_id);
    if (!genome) return json(res, 404, { error: 'Story Genome not found' });
    json(res, 200, genome);
  });
}
