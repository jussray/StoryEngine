// routes/studio.js

import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { forgeIdeas, listIdeas, getIdea, selectIdea } from '../lib/ideaForge.js';
import { buildStoryArchitecture, getArchitecture } from '../lib/storyArchitect.js';
import { buildChapterDraft, buildAllChapterDrafts } from '../lib/chapterBuilder.js';

export default function studioRoutes(router, db) {
  router.post('/api/studio/ideas/generate', (req, res) => {
    try {
      const workspaceId = req.body?.workspace_id;
      if (!workspaceId) return json(res, 400, { error: 'workspace_id required' });
      if (!requireWorkspaceAccess(req, res, workspaceId)) return;
      const ideas = forgeIdeas(db, req.body || {});
      json(res, 201, { ideas });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/studio/ideas', (req, res) => {
    try {
      const workspaceId = req.query.workspace_id;
      if (!workspaceId) return json(res, 400, { error: 'workspace_id required' });
      if (!requireWorkspaceAccess(req, res, workspaceId)) return;
      json(res, 200, listIdeas(db, {
        workspace_id: req.query.workspace_id || null,
        limit: req.query.limit
      }));
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/studio/ideas/:idea_id', (req, res) => {
    const idea = getIdea(db, req.params.idea_id);
    if (!idea) return json(res, 404, { error: 'Idea not found.' });
    if (!idea.workspace_id) return json(res, 403, { error: 'Idea has no authorized workspace.' });
    if (!requireWorkspaceAccess(req, res, idea.workspace_id)) return;
    json(res, 200, idea);
  });

  router.post('/api/studio/ideas/:idea_id/select', (req, res) => {
    const existing = getIdea(db, req.params.idea_id);
    if (!existing) return json(res, 404, { error: 'Idea not found.' });
    if (!existing.workspace_id) return json(res, 403, { error: 'Idea has no authorized workspace.' });
    if (!requireWorkspaceAccess(req, res, existing.workspace_id)) return;
    const idea = selectIdea(db, req.params.idea_id);
    json(res, 200, idea);
  });

  router.post('/api/studio/architect/generate', (req, res) => {
    try {
      const workspaceId = req.body?.workspace_id;
      if (!workspaceId) return json(res, 400, { error: 'workspace_id required' });
      if (!requireWorkspaceAccess(req, res, workspaceId)) return;
      const result = buildStoryArchitecture(db, req.body || {});
      json(res, result.validation.passed ? 201 : 202, result);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/studio/architect/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const architecture = getArchitecture(db, workspace_id);
    if (!architecture) return json(res, 404, { error: 'Story architecture not found.' });
    json(res, 200, architecture);
  });

  router.post('/api/studio/chapters/build', (req, res) => {
    try {
      const workspaceId = req.body?.workspace_id;
      if (!workspaceId) return json(res, 400, { error: 'workspace_id required' });
      if (!requireWorkspaceAccess(req, res, workspaceId)) return;
      const result = buildChapterDraft(db, req.body || {});
      json(res, result.action === 'created' ? 201 : 200, result);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.post('/api/studio/chapters/build-all', (req, res) => {
    try {
      const workspaceId = req.body?.workspace_id;
      if (!workspaceId) return json(res, 400, { error: 'workspace_id required' });
      if (!requireWorkspaceAccess(req, res, workspaceId)) return;
      const results = buildAllChapterDrafts(db, req.body || {});
      json(res, 201, { chapters: results });
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });
}
