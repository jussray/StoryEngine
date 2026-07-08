// routes/eventRetention.js

import { json } from '../lib/miniRouter.js';
import { getRetentionStatus, runEventRetention } from '../lib/eventRetention.js';

export default function eventRetentionRoutes(router, db) {
  router.get('/api/events/retention/status', (req, res) => {
    try {
      const keepMs = req.query.keep_ms == null ? undefined : Number(req.query.keep_ms);
      json(res, 200, getRetentionStatus(db, keepMs));
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.post('/api/events/retention/run', (req, res) => {
    try {
      const result = runEventRetention(db, {
        keepMs: req.body?.keep_ms == null ? undefined : Number(req.body.keep_ms),
        limit: req.body?.limit == null ? undefined : Number(req.body.limit),
        dryRun: req.body?.dry_run === true
      });
      json(res, 200, result);
    } catch (error) {
      const badRequest = /keep_ms|limit/.test(error.message);
      json(res, badRequest ? 400 : 500, { error: error.message });
    }
  });
}
