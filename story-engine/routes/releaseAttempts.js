// routes/releaseAttempts.js

import { json } from '../lib/miniRouter.js';
import {
  createReleaseAttempt,
  completeReleaseAttempt,
  failReleaseAttempt,
  getReleaseAttempt,
  listReleaseAttempts,
  reconcileStaleReleaseAttempts
} from '../lib/releaseAttempts.js';

function transitionFailure(res, error) {
  if (error?.code === 'INVALID_RELEASE_ATTEMPT_TRANSITION') {
    return json(res, 409, { error: error.message, attempt: error.attempt });
  }
  throw error;
}

export default function releaseAttemptRoutes(router, db) {
  router.post('/api/release/attempt/:workspace_id', (req, res) => {
    try {
      const result = createReleaseAttempt(
        db,
        req.params.workspace_id,
        req.body?.operation || 'release',
        {
          allowWarning: req.body?.allow_warning === true,
          confidenceThreshold: req.body?.confidence_threshold,
          p99Limit: req.body?.p99_limit,
          staleAfterMs: req.body?.stale_after_ms
        }
      );

      if (!result) return json(res, 404, { error: 'Workspace not found' });
      if (result.deduplicated) return json(res, 200, result);
      json(res, result.allowed ? 201 : 409, result);
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.post('/api/release/attempts/reconcile', (req, res) => {
    try {
      const attempts = reconcileStaleReleaseAttempts(db, {
        staleAfterMs: req.body?.stale_after_ms
      });
      json(res, 200, { reconciled: attempts.length, attempts });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/release/attempts/:workspace_id', (req, res) => {
    json(res, 200, listReleaseAttempts(db, req.params.workspace_id, req.query.limit));
  });

  router.get('/api/release/attempt/:attempt_id', (req, res) => {
    const attempt = getReleaseAttempt(db, req.params.attempt_id);
    if (!attempt) return json(res, 404, { error: 'Attempt not found' });
    json(res, 200, attempt);
  });

  router.post('/api/release/attempt/:attempt_id/complete', (req, res) => {
    try {
      const attempt = completeReleaseAttempt(db, req.params.attempt_id, req.body?.result || {});
      if (!attempt) return json(res, 404, { error: 'Attempt not found' });
      json(res, 200, attempt);
    } catch (error) {
      transitionFailure(res, error);
    }
  });

  router.post('/api/release/attempt/:attempt_id/fail', (req, res) => {
    try {
      const attempt = failReleaseAttempt(db, req.params.attempt_id, req.body?.error || 'Operation failed');
      if (!attempt) return json(res, 404, { error: 'Attempt not found' });
      json(res, 200, attempt);
    } catch (error) {
      transitionFailure(res, error);
    }
  });
}
