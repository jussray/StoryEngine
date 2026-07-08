// routes/releaseGate.js

import { json } from '../lib/miniRouter.js';
import { evaluateReleaseGate, persistReleaseGate, assertReleaseAllowed } from '../lib/releaseGate.js';

export default function releaseGateRoutes(router, db) {
  router.get('/api/release/gate/:workspace_id', (req, res) => {
    const gate = evaluateReleaseGate(db, req.params.workspace_id, {
      confidenceThreshold: req.query.confidence_threshold,
      p99Limit: req.query.p99_limit
    });
    if (!gate) return json(res, 404, { error: 'Workspace not found' });
    json(res, 200, gate);
  });

  router.post('/api/release/gate/:workspace_id/audit', (req, res) => {
    const gate = persistReleaseGate(db, req.params.workspace_id, req.body?.operation || 'release_check', {
      confidenceThreshold: req.body?.confidence_threshold,
      p99Limit: req.body?.p99_limit
    });
    if (!gate) return json(res, 404, { error: 'Workspace not found' });
    json(res, 200, gate);
  });

  router.post('/api/release/authorize/:workspace_id', (req, res) => {
    const result = assertReleaseAllowed(db, req.params.workspace_id, req.body?.operation || 'release', {
      confidenceThreshold: req.body?.confidence_threshold,
      p99Limit: req.body?.p99_limit,
      allowWarning: req.body?.allow_warning !== false
    });
    if (!result.gate) return json(res, 404, { error: result.error });
    json(res, result.statusCode, result);
  });
}
