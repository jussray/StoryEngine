// routes/studio.js

import { json } from '../lib/miniRouter.js';
import { forgeIdeas, listIdeas, getIdea, selectIdea } from '../lib/ideaForge.js';
import { buildStoryArchitecture, getArchitecture } from '../lib/storyArchitect.js';

export default function studioRoutes(router, db) {
  router.post('/api/studio/ideas/generate', (req, res) => {
    try {
      const ideas = forgeIdeas(db, req.body || {});
      json(res, 201, { ideas });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });

  router.get('/api/studio/ideas', (req, res) => {
    try {
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
    json(res, 200, idea);
  });

  router.post('/api/studio/ideas/:idea_id/select', (req, res) => {
    const idea = selectIdea(db, req.params.idea_id);
    if (!idea) return json(res, 404, { error: 'Idea not found.' });
    json(res, 200, idea);
  });

  router.post('/api/studio/architect/generate', (req, res) => {
    try {
      const result = buildStoryArchitecture(db, req.body || {});
      json(res, result.validation.passed ? 201 : 202, result);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      json(res, status, { error: error.message });
    }
  });

  router.get('/api/studio/architect/:workspace_id', (req, res) => {
    const architecture = getArchitecture(db, req.params.workspace_id);
    if (!architecture) return json(res, 404, { error: 'Story architecture not found.' });
    json(res, 200, architecture);
  });
}
