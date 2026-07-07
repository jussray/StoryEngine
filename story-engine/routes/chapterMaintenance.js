// routes/chapterMaintenance.js

import { json } from '../lib/miniRouter.js';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { runAutonomousRuntime } from '../lib/autonomousRuntime.js';

export default function chapterMaintenanceRoutes(router, db) {
  router.delete('/api/chapters/:id', (req, res) => {
    const id = Number(req.params.id);
    const chapter = Chapter.get(db, id);
    if (!chapter) return json(res, 404, { error: 'Not found' });

    Chapter.remove(db, id);
    log(db, {
      workspace_id: chapter.workspace_id,
      event_type: 'chapter_deleted',
      payload: { id }
    });

    const runtime = runAutonomousRuntime(db, {
      workspaceId: chapter.workspace_id,
      triggerType: 'chapter_deleted',
      allowRecovery: false
    });

    json(res, 200, {
      ok: true,
      runtime: {
        run_id: runtime.run_id,
        correlation_id: runtime.correlation_id,
        status: runtime.status,
        release: runtime.result?.release || null,
        prediction: runtime.result?.prediction || null
      }
    });
  });
}
