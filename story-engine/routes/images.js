// Workspace-gated image generation, storage and serving.
import { json } from '../lib/miniRouter.js';
import { getArtifact } from '../lib/artifactValidation.js';
import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';
import {
  generateArtifactImage, getImageAsset, listImageAssets,
  refreshImageAsset, imageAssetFile, streamImageFile, workspaceImageSpend
} from '../lib/imageAssets.js';
import { randomUUID } from 'node:crypto';

function ownArtifact(db, req, res) {
  const artifact = getArtifact(db, req.params.artifact_id);
  if (!artifact) { json(res, 404, { error: 'artifact_not_found' }); return null; }
  return requireWorkspaceAccess(req, res, artifact.workspace_id) ? artifact : null;
}
function ownImage(db, req, res) {
  const image = getImageAsset(db, req.params.image_id);
  if (!image) { json(res, 404, { error: 'image_not_found' }); return null; }
  return requireWorkspaceAccess(req, res, image.workspace_id) ? image : null;
}
function imageError(res, error) {
  const message = String(error?.message || '');
  const safe = /^(Artifact not found\.|Unsupported artifact image kind\.|Invalid chapter index\.|Image count cap reached for artifact\.)$/.test(message);
  json(res, safe ? 400 : 500, { error: safe ? message : 'image_operation_failed' });
}

export default function imageRoutes(router, db) {
  router.post('/api/images/artifacts/:artifact_id/cover', requireRole('creator'), async (req, res) => {
    try {
      if (!ownArtifact(db, req, res)) return;
      const image = await generateArtifactImage(db, req.params.artifact_id, { kind: 'cover' });
      json(res, image.status === 'pending' ? 202 : 200, image);
    } catch (error) { imageError(res, error); }
  });

  router.post('/api/images/artifacts/:artifact_id/chapter', requireRole('creator'), async (req, res) => {
    try {
      if (!ownArtifact(db, req, res)) return;
      // An explicit opt-in is mandatory even for existing children's-book profiles.
      if (req.body?.include_visual !== true) return json(res, 400, { error: 'chapter_visual_opt_in_required' });
      const image = await generateArtifactImage(db, req.params.artifact_id, {
        kind: 'chapter_visual', chapterIndex: req.body?.chapter_index
      });
      json(res, image.status === 'pending' ? 202 : 200, image);
    } catch (error) { imageError(res, error); }
  });

  router.get('/api/images/artifacts/:artifact_id', (req, res) => {
    try {
      if (!ownArtifact(db, req, res)) return;
      json(res, 200, listImageAssets(db, req.params.artifact_id));
    } catch (error) { imageError(res, error); }
  });

  router.get('/api/images/:image_id', (req, res) => {
    try {
      const image = ownImage(db, req, res);
      if (image) json(res, 200, image);
    } catch (error) { imageError(res, error); }
  });

  router.post('/api/images/:image_id/refresh', requireRole('creator'), async (req, res) => {
    try {
      if (!ownImage(db, req, res)) return;
      const image = await refreshImageAsset(db, req.params.image_id);
      json(res, image?.status === 'pending' ? 202 : 200, image);
    } catch (error) { imageError(res, error); }
  });

  router.post('/api/images/:image_id/regenerate', requireRole('creator'), async (req, res) => {
    try {
      const existing = ownImage(db, req, res);
      if (!existing) return;
      if (existing.kind === 'campaign_frame') return json(res, 400, { error: 'unsupported_regeneration_kind' });
      // Explicit regenerate action creates a distinct retained asset.
      const image = await generateArtifactImage(db, existing.artifact_id, {
        kind: existing.kind, chapterIndex: existing.chapter_index, variant: randomUUID()
      });
      json(res, image.status === 'pending' ? 202 : 200, image);
    } catch (error) { imageError(res, error); }
  });

  router.get('/api/images/:image_id/file', async (req, res) => {
    try {
      if (!ownImage(db, req, res)) return;
      const file = await imageAssetFile(db, req.params.image_id);
      if (!file) return json(res, 404, { error: 'image_file_not_found' });
      streamImageFile(file, res);
    } catch (error) { imageError(res, error); }
  });

  router.get('/api/workspaces/:workspace_id/image-spend', (req, res) => {
    try {
      if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
      json(res, 200, workspaceImageSpend(db, req.params.workspace_id));
    } catch (error) { imageError(res, error); }
  });
}
