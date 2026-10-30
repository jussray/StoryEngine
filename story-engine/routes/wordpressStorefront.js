// Workspace-bound WordPress draft handoff; no live WordPress or KDP publishing.
import { json } from '../lib/miniRouter.js';
import { getArtifact } from '../lib/artifactValidation.js';
import { evaluateReleaseGate } from '../lib/releaseGate.js';
import { requireWorkspaceAccess, roleAtLeast } from '../lib/securityContext.js';
import { log } from '../models/eventModel.js';
import {
  buildWordPressBookDraft, wordpressConnection, createWordPressBookDraft, StorefrontError
} from '../lib/wordpressBookStorefront.js';

export default function wordpressStorefrontRoutes(router, db) {
  router.post('/api/workspaces/:workspace_id/wordpress/book-draft', async (req, res) => {
    const workspaceId = req.params.workspace_id;
    if (!requireWorkspaceAccess(req, res, workspaceId)) return;
    if (!roleAtLeast(req.auth, 'release_manager')) {
      return json(res, 403, { error: 'release_manager_required' });
    }
    if (req.body?.confirm_draft !== true) {
      return json(res, 400, { error: 'explicit_draft_confirmation_required' });
    }
    try {
      const artifact = getArtifact(db, req.body.artifact_id);
      if (!artifact || artifact.workspace_id !== workspaceId) {
        return json(res, 404, { error: 'artifact_not_found' });
      }
      const gate = evaluateReleaseGate(db, workspaceId);
      if (gate?.status !== 'READY') {
        return json(res, 409, {
          error: 'release_gate_not_ready', gate_status: gate?.status || 'UNKNOWN'
        });
      }
      const story = db.prepare('SELECT title, pitch FROM stories WHERE workspace_id=?').get(workspaceId);
      const draft = buildWordPressBookDraft({
        workspaceId, artifact, story, amazonUrl: req.body.amazon_url
      });
      const result = await createWordPressBookDraft(wordpressConnection(), draft);
      log(db, { workspace_id: workspaceId, mode: 'wordpress_storefront',
        event_type: 'wordpress.book_draft_verified',
        payload: {
          artifact_id: artifact.artifact_id, artifact_hash: artifact.content_hash,
          wordpress_post_id: result.id, wordpress_status: 'draft',
          deduplicated: result.deduplicated, amazon_link_included: Boolean(req.body.amazon_url)
        } });
      return json(res, result.deduplicated ? 200 : 201, {
        status: 'wordpress_draft_verified', artifact_id: artifact.artifact_id,
        wordpress_post_id: result.id, wordpress_status: 'draft',
        deduplicated: result.deduplicated, preview_url: result.link,
        amazon_sale_verified: false, kdp_publication_verified: false
      });
    } catch (error) {
      const known = error instanceof StorefrontError;
      if (known && error.code === 'wordpress_outcome_unknown') {
        try {
          log(db, { workspace_id: workspaceId, mode: 'wordpress_storefront',
            event_type: 'wordpress.book_draft_unknown',
            payload: { artifact_id: String(req.body.artifact_id || '') } });
        } catch {}
      }
      return json(res, known ? error.status : 500,
        { error: known ? error.code : 'wordpress_draft_failed' });
    }
  });
}
