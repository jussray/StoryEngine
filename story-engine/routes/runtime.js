// routes/runtime.js

import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { runAutonomousRuntime, getRuntimeRun, listRuntimeRuns } from '../lib/autonomousRuntime.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';

export default function runtimeRoutes(router, db) {
  router.post('/api/runtime/run/:workspace_id', (req, res) => {
    const chapterId = req.body?.chapter_id ? Number(req.body.chapter_id) : null;
    const chapter = chapterId ? Chapter.get(db, chapterId) : null;
    if (chapterId && !chapter) return json(res, 404, { error: 'Chapter not found' });
    if (chapter && chapter.workspace_id !== req.params.workspace_id) {
      return json(res, 400, { error: 'Chapter does not belong to workspace' });
    }

    const run = runAutonomousRuntime(db, {
      workspaceId: req.params.workspace_id,
      chapter,
      triggerType: req.body?.trigger_type || 'manual_runtime_run',
      correlationId: req.body?.correlation_id || null,
      allowRecovery: req.body?.allow_recovery !== false
    });
    json(res, run.status === 'failed' ? 500 : 200, run);
  });

  router.get('/api/runtime/run/:run_id', (req, res) => {
    const run = getRuntimeRun(db, req.params.run_id);
    if (!run) return json(res, 404, { error: 'Runtime run not found' });
    if (!requireWorkspaceAccess(req, res, run.workspace_id)) return;
    json(res, 200, run);
  });

  router.get('/api/runtime/runs/:workspace_id', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, listRuntimeRuns(db, req.params.workspace_id, limit));
  });
}
