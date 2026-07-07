// routes/outline.js
import { json } from '../lib/miniRouter.js';
import * as Outline from '../models/outlineModel.js';
import { log } from '../models/eventModel.js';

export default function outlineRoutes(router, db) {
  router.get('/api/outline/:workspace_id', (req, res) => {
    const outline = Outline.get(db, req.params.workspace_id);
    json(res, 200, outline || { workspace_id: req.params.workspace_id, content: '' });
  });

  router.put('/api/outline/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const { content } = req.body || {};
    const t0 = Date.now();
    Outline.upsert(db, workspace_id, content ?? '');
    log(db, { workspace_id, event_type: 'outline_updated', duration_ms: Date.now() - t0 });
    json(res, 200, { ok: true });
  });
}
