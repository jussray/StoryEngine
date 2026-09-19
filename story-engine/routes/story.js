// routes/story.js
import { json } from '../lib/miniRouter.js';
import * as Story from '../models/storyModel.js';
import { log } from '../models/eventModel.js';
import { canCreateWorkspace, workspaceCreationDenial } from '../lib/workspaceCreationAuthority.js';

export default function storyRoutes(router, db) {
  router.get('/api/stories', (req, res) => {
    json(res, 200, Story.list(db, req.auth));
  });

  router.get('/api/story/:workspace_id', (req, res) => {
    const story = Story.get(db, req.params.workspace_id);
    if (!story) return json(res, 404, { error: 'Not found' });
    json(res, 200, story);
  });

  router.post('/api/story', (req, res) => {
    if (!canCreateWorkspace(req.auth)) {
      return json(res, 403, { ...workspaceCreationDenial(req.auth), request_id: req.request_id });
    }
    const { title, genre, pitch } = req.body || {};
    if (!title) return json(res, 400, { error: 'title required' });
    const t0 = Date.now();
    const workspace_id = Story.create(db, {
      title,
      genre,
      pitch,
      tenant_id: req.auth?.tenant_id,
      actor_id: req.auth?.actor_id,
      role: req.auth?.role || 'creator'
    });
    log(db, { workspace_id, event_type: 'story_created', payload: { title, genre }, duration_ms: Date.now() - t0 });
    json(res, 201, { workspace_id });
  });

  router.put('/api/story/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const t0 = Date.now();
    Story.update(db, workspace_id, req.body);
    log(db, { workspace_id, event_type: 'story_updated', duration_ms: Date.now() - t0 });
    json(res, 200, { ok: true });
  });
}
