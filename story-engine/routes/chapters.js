// routes/chapters.js
import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { enqueueRuntime } from '../lib/runtimeDispatcher.js';
import { getGenomeContext, patchMemoryFromChapter } from '../lib/memoryEngine.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';

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

  router.get('/api/chapters/:workspace_id/memory-context', (req, res) => {
    json(res, 200, getGenomeContext(db, req.params.workspace_id));
  });

  router.post('/api/chapters/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const { title, content, position, memory_patches } = req.body || {};
    if (!title) return json(res, 400, { error: 'title required' });

    const startedAt = Date.now();
    const id = Chapter.create(db, workspace_id, { title, content, position });
    const memoryDiffs = patchMemoryFromChapter(
      db,
      workspace_id,
      Number(id),
      content || '',
      memory_patches
    );
    log(db, {
      workspace_id,
      event_type: 'chapter_created',
      payload: { id, title, memory_diff_count: memoryDiffs.length },
      duration_ms: Date.now() - startedAt
    });

    const dispatch = enqueueRuntime(db, workspace_id, 'chapter_created', Number(id));
    json(res, 202, {
      id,
      ok: true,
      queued: true,
      dispatch: dispatchSummary(dispatch),
      memory: {
        patched: true,
        diff_count: memoryDiffs.length,
        context: getGenomeContext(db, workspace_id)
      },
      lindymode: { queued: true, incidents: [] }
    });
  });

  router.put('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });
    if (!requireWorkspaceAccess(req, res, chapter.workspace_id)) return;

    const startedAt = Date.now();
    Chapter.update(db, id, req.body);
    const updated = Chapter.get(db, id);
    const memoryDiffs = patchMemoryFromChapter(
      db,
      chapter.workspace_id,
      id,
      updated?.content || updated?.text || '',
      req.body?.memory_patches
    );
    log(db, {
      workspace_id: chapter.workspace_id,
      event_type: 'chapter_updated',
      payload: { id, memory_diff_count: memoryDiffs.length },
      duration_ms: Date.now() - startedAt
    });

    const dispatch = enqueueRuntime(db, chapter.workspace_id, 'chapter_updated', id);
    json(res, 202, {
      ok: true,
      queued: true,
      dispatch: dispatchSummary(dispatch),
      memory: {
        patched: true,
        diff_count: memoryDiffs.length,
        context: getGenomeContext(db, chapter.workspace_id)
      },
      lindymode: { queued: true, incidents: [] }
    });
  });
}
