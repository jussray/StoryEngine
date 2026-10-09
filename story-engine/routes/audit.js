// routes/audit.js

import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { runSeriesContinuityAudit } from '../lib/seriesAudit.js';

export default function auditRoutes(router, db) {
  router.post('/api/audit/series-continuity', async (req, res) => {
    try {
      const report = await runSeriesContinuityAudit(db, req.body || {});
      json(res, 201, report);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/audit/series-continuity/:workspace_id/latest', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const rows = db.prepare(`
      SELECT * FROM events
      WHERE workspace_id = ?
        AND mode = 'series_audit'
      ORDER BY created_at DESC
      LIMIT 10
    `).all(workspace_id).map(row => {
      let payload = {};
      try { payload = JSON.parse(row.payload || '{}'); } catch {}
      return { ...row, payload };
    });
    json(res, 200, rows);
  });
}
