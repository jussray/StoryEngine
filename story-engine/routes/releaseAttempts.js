// routes/releaseAttempts.js

import { json } from '../lib/miniRouter.js';
import {
  createReleaseAttempt,
  completeReleaseAttempt,
  failReleaseAttempt,
  getReleaseAttempt,
  listReleaseAttempts
} from '../lib/releaseAttempts.js';

export default function releaseAttemptRoutes(router, db) {
  router.post('/api/release/attempt/:workspace_id', (req, res) => {
    const result = createReleaseAttempt(
      db,
      req.params.workspace_id,
      req.body?.operation || 'release',
      {
        allowWarning: req.body?.allow_warning === true,
        confidenceThreshold: req.body?.confidence_threshold,
        p99Limit: req.body?.p99_limit
      }
    );

    if (!result) return json(res, 404, { error: 'Workspace not found' });
    json(res, result.allowed ? 201 : 409, result);
  });

  router.get('/api/release/attempts/:workspace_id', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, listReleaseAttempts(db, req.params.workspace_id, limit));
  });

  router.get('/api/release/attempt/:attempt_id', (req, res) => {
    const attempt = getReleaseAttempt(db, req.params.attempt_id);
    if (!attempt) return json(res, 404, { error: 'Attempt not found' });
    json(res, 200, attempt);
  });

  router.post('/api/release/attempt/:attempt_id/complete', (req, res) => {
    const attempt = completeReleaseAttempt(db, req.params.attempt_id, req.body?.result || {});
    if (!attempt) return json(res, 404, { error: 'Attempt not found' });
    json(res, 200, attempt);
  });

  router.post('/api/release/attempt/:attempt_id/fail', (req, res) => {
    const attempt = failReleaseAttempt(db, req.params.attempt_id, req.body?.error || 'Operation failed');
    if (!attempt) return json(res, 404, { error: 'Attempt not found' });
    json(res, 200, attempt);
  });
}
