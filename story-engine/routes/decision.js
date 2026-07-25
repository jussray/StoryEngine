// routes/decision.js

import { json } from '../lib/miniRouter.js';
import { evaluateWorkspace, persistDecision, runReleaseAudit } from '../lib/decisionEngine.js';
import { requireRole } from '../lib/securityContext.js';

export default function decisionRoutes(router, db) {
  router.get('/api/ooda/decision/:workspace_id', (req, res) => {
    const decision = evaluateWorkspace(db, req.params.workspace_id);
    json(res, 200, decision);
  });

  router.post('/api/ooda/decision/:workspace_id', (req, res) => {
    requireRole('reviewer')(req, res, () => {
      const decision = persistDecision(db, evaluateWorkspace(db, req.params.workspace_id));
      json(res, 201, decision);
    });
  });

  router.post('/api/ooda/release-audit/:workspace_id', (req, res) => {
    requireRole('release_manager')(req, res, () => {
      const audit = runReleaseAudit(db, req.params.workspace_id);
      json(res, audit.result === 'READY' ? 200 : 409, audit);
    });
  });

  router.get('/api/ooda/release-audits/:workspace_id', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM release_audits
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.params.workspace_id).map(row => ({
      ...row,
      checks: JSON.parse(row.checks_json || '[]'),
      blockers: JSON.parse(row.blockers_json || '[]')
    }));
    json(res, 200, rows);
  });
}
