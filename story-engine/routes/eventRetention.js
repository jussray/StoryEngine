// routes/eventRetention.js

import { json } from '../lib/miniRouter.js';
import { getRetentionStatus, runEventRetention } from '../lib/eventRetention.js';

export default function eventRetentionRoutes(router, db) {
  router.get('/api/events/retention/status', (req, res) => {
    const keepMs = req.query.keep_ms ? Number(req.query.keep_ms) : undefined;
    json(res, 200, getRetentionStatus(db, keepMs));
  });

  router.post('/api/events/retention/run', (req, res) => {
    try {
      const result = runEventRetention(db, {
        keepMs: req.body?.keep_ms ? Number(req.body.keep_ms) : undefined,
        limit: req.body?.limit ? Number(req.body.limit) : undefined,
        dryRun: Boolean(req.body?.dry_run)
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
