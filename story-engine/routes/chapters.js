// routes/chapters.js
import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { runAutonomousRuntime } from '../lib/autonomousRuntime.js';

function summarizeRuntime(runtime) {
  return {
    run_id: runtime.run_id,
    correlation_id: runtime.correlation_id,
    status: runtime.status,
    release: runtime.result?.release || null,
    prediction: runtime.result?.prediction || null
  };
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

    const chapter = Chapter.get(db, Number(id));
    const runtime = runAutonomousRuntime(db, {
      workspaceId: workspace_id,
      chapter,
      triggerType: 'chapter_created'
    });

    json(res, 201, {
      id,
      lindymode: runtime.result?.analysis || { incidents: [] },
      runtime: summarizeRuntime(runtime)
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

    const updated = Chapter.get(db, id);
    const runtime = runAutonomousRuntime(db, {
      workspaceId: chapter.workspace_id,
      chapter: updated,
      triggerType: 'chapter_updated'
    });

    json(res, 200, {
      ok: true,
      lindymode: runtime.result?.analysis || { incidents: [] },
      runtime: summarizeRuntime(runtime)
    });
  });
}
