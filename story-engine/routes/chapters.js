// routes/chapters.js
import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { enqueueRuntime } from '../lib/runtimeDispatcher.js';

function dispatchSummary(dispatch) {
  return dispatch ? {
    dispatch_id: dispatch.dispatch_id,
    status: dispatch.status,
    deduplicated: Boolean(dispatch.deduplicated),
    trigger_type: dispatch.trigger_type,
    chapter_id: dispatch.chapter_id ?? null
  } : null;
}

export default function chapterRoutes(router, db) {
  router.get('/api/chapters/:workspace_id', (req, res) => {
    json(res, 200, Chapter.list(db, req.params.workspace_id));
  });

  router.post('/api/chapters/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const { title, content, position } = req.body || {};
    if (!title) return json(res, 400, { error: 'title required' });

    const startedAt = Date.now();
    const id = Chapter.create(db, workspace_id, { title, content, position });
    log(db, {
      workspace_id,
      event_type: 'chapter_created',
      payload: { id, title },
      duration_ms: Date.now() - startedAt
    });

    const dispatch = enqueueRuntime(db, workspace_id, 'chapter_created', Number(id));
    json(res, 202, {
      id,
      ok: true,
      queued: true,
      dispatch: dispatchSummary(dispatch),
      lindymode: { queued: true, incidents: [] }
    });
  });

  router.put('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });

    const startedAt = Date.now();
    Chapter.update(db, id, req.body);
    log(db, {
      workspace_id: chapter.workspace_id,
      event_type: 'chapter_updated',
      payload: { id },
      duration_ms: Date.now() - startedAt
    });

    const dispatch = enqueueRuntime(db, chapter.workspace_id, 'chapter_updated', id);
    json(res, 202, {
      ok: true,
      queued: true,
      dispatch: dispatchSummary(dispatch),
      lindymode: { queued: true, incidents: [] }
    });
  });
}
