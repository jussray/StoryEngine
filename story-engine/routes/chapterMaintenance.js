// routes/chapterMaintenance.js

import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { enqueueRuntime } from '../lib/runtimeDispatcher.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';

export default function chapterMaintenanceRoutes(router, db) {
  router.delete('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });
    if (!requireWorkspaceAccess(req, res, chapter.workspace_id)) return;

    Chapter.remove(db, id);
    log(db, {
      workspace_id: chapter.workspace_id,
      event_type: 'chapter_deleted',
      payload: { id }
    });

    const dispatch = enqueueRuntime(db, chapter.workspace_id, 'chapter_deleted');
    json(res, 202, {
      ok: true,
      queued: true,
      dispatch: dispatch ? {
        dispatch_id: dispatch.dispatch_id,
        status: dispatch.status,
        deduplicated: Boolean(dispatch.deduplicated),
        trigger_type: dispatch.trigger_type
      } : null
    });
  });
}
