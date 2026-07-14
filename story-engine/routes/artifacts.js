// routes/artifacts.js

import { json } from '../lib/miniRouter.js';
import { getArtifact, listArtifacts, validateArtifactWithPlaywright } from '../lib/artifactValidation.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';

export default function artifactRoutes(router, db) {
  router.get('/api/artifacts/:artifact_id', (req, res) => {
    try {
      const artifact = getArtifact(db, req.params.artifact_id);
      if (!artifact) return json(res, 404, { error: 'Artifact not found.' });
      if (!requireWorkspaceAccess(req, res, artifact.workspace_id)) return;
      json(res, 200, artifact);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.get('/api/artifacts/:artifact_id/html', (req, res) => {
    try {
      const artifact = getArtifact(db, req.params.artifact_id);
      if (!artifact) return json(res, 404, { error: 'Artifact not found.' });
      if (!requireWorkspaceAccess(req, res, artifact.workspace_id)) return;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(artifact.html);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });

  router.post('/api/artifacts/:artifact_id/validate', async (req, res) => {
    try {
      const artifact = getArtifact(db, req.params.artifact_id);
      if (!artifact) return json(res, 404, { error: 'Artifact not found.' });
      if (!requireWorkspaceAccess(req, res, artifact.workspace_id)) return;
      json(res, 200, await validateArtifactWithPlaywright(db, req.params.artifact_id));
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/workspaces/:workspace_id/artifacts', (req, res) => {
    try {
      json(res, 200, listArtifacts(db, req.params.workspace_id, Number(req.query.limit || 50)));
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}
