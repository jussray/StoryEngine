// routes/events.js
import { json } from '../lib/miniRouter.js';
import { list } from '../models/eventModel.js';

export default function eventsRoutes(router, db) {
  router.get('/api/events/:workspace_id', (req, res) => {
    const limit = Number(req.query.limit) || 200;
    json(res, 200, list(db, req.params.workspace_id, limit));
  });
}
