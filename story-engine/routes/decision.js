// routes/decision.js

import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { evaluateWorkspace, persistDecision, runReleaseAudit } from '../lib/decisionEngine.js';

export default function decisionRoutes(router, db) {
  router.get('/api/ooda/decision/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const decision = evaluateWorkspace(db, workspace_id);
    json(res, 200, decision);
  });

  router.post('/api/ooda/decision/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const decision = persistDecision(db, evaluateWorkspace(db, workspace_id));
    json(res, 201, decision);
  });

  router.post('/api/ooda/release-audit/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const audit = runReleaseAudit(db, workspace_id);
    json(res, audit.result === 'READY' ? 200 : 409, audit);
  });

  router.get('/api/ooda/release-audits/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const rows = db.prepare(`
      SELECT * FROM release_audits
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(workspace_id).map(row => ({
      ...row,
      checks: JSON.parse(row.checks_json || '[]'),
      blockers: JSON.parse(row.blockers_json || '[]')
    }));
    json(res, 200, rows);
  });
}
