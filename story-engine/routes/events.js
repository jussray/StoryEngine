// routes/events.js
import { json } from '../lib/miniRouter.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';
import { list } from '../models/eventModel.js';

export default function eventsRoutes(router, db) {
  router.get('/api/events/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    const limit = Number(req.query.limit) || 200;
    json(res, 200, list(db, workspace_id, limit));
  });
}
