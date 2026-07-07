// routes/chapters.js
import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { analyzeChapter } from '../lib/lindymodeProcessor.js';

export default function chapterRoutes(router, db) {
  router.get('/api/chapters/:workspace_id', (req, res) => {
    json(res, 200, Chapter.list(db, req.params.workspace_id));
  });

  router.post('/api/chapters/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const { title, content, position } = req.body || {};
    if (!title) return json(res, 400, { error: 'title required' });
    const t0 = Date.now();
    const id = Chapter.create(db, workspace_id, { title, content, position });
    log(db, { workspace_id, event_type: 'chapter_created', payload: { id, title }, duration_ms: Date.now() - t0 });
    const chapter = Chapter.get(db, Number(id));
    const lindymode = analyzeChapter(db, chapter, { parent_event_id: `chapter_created:${id}` });
    json(res, 201, { id, lindymode });
  });

  router.put('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });
    const t0 = Date.now();
    Chapter.update(db, id, req.body);
    log(db, { workspace_id: chapter.workspace_id, event_type: 'chapter_updated', payload: { id }, duration_ms: Date.now() - t0 });
    const updated = Chapter.get(db, id);
    const lindymode = analyzeChapter(db, updated, { parent_event_id: `chapter_updated:${id}` });
    json(res, 200, { ok: true, lindymode });
  });

  router.delete('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });
    Chapter.remove(db, id);
    log(db, { workspace_id: chapter.workspace_id, event_type: 'chapter_deleted', payload: { id } });
    json(res, 200, { ok: true });
  });
}
