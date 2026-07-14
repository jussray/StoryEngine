// routes/lindymode.js

import { json } from '../lib/miniRouter.js';
import * as Lindy from '../models/lindymodeModel.js';
import * as Chapter from '../models/chapterModel.js';
import { analyzeChapter } from '../lib/lindymodeProcessor.js';
import { captureEpisodeFromIncident } from '../lib/learningEngine.js';
import { log } from '../models/eventModel.js';
import { requireWorkspaceAccess } from '../lib/securityContext.js';

export default function lindymodeRoutes(router, db) {
  router.get('/api/lindymode/state/:workspace_id', (req, res) => {
    const state = Lindy.getState(db, req.params.workspace_id);
    json(res, state ? 200 : 404, state || { error: 'Lindymode state not found' });
  });

  router.put('/api/lindymode/state/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const state = Lindy.upsertState(db, workspace_id, req.body || {});
    log(db, {
      workspace_id,
      mode: 'lindymode',
      event_type: 'lindymode.summary_refresh_triggered',
      payload: { state_version: state.version, arc_stage: state.arc_stage, pov: state.pov }
    });
    json(res, 200, state);
  });

  router.post('/api/lindymode/analyze/:chapter_id', (req, res) => {
    const chapter = Chapter.get(db, Number(req.params.chapter_id));
    if (!chapter) return json(res, 404, { error: 'Chapter not found' });
    if (!requireWorkspaceAccess(req, res, chapter.workspace_id)) return;
    json(res, 200, analyzeChapter(db, chapter, req.body || {}));
  });

  router.get('/api/lindymode/incidents/:workspace_id', (req, res) => {
    const status = req.query.status || null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, Lindy.listIncidents(db, req.params.workspace_id, status, limit));
  });

  router.post('/api/lindymode/recover/:incident_id', (req, res) => {
    const recoveryAction = req.body?.recovery_action || 'manual_state_review';
    const outcome = req.body?.outcome || 'unknown';
    const target = Lindy.getIncident(db, req.params.incident_id);
    if (!target) return json(res, 404, { error: 'Incident not found' });
    if (!requireWorkspaceAccess(req, res, target.workspace_id)) return;

    const incident = Lindy.resolveIncident(db, req.params.incident_id, recoveryAction);
    if (!incident) return json(res, 404, { error: 'Incident not found' });

    log(db, {
      workspace_id: incident.workspace_id,
      mode: 'lindymode',
      event_type: 'lindymode.recovery_completed',
      payload: {
        incident_id: incident.incident_id,
        correlation_id: incident.correlation_id,
        recovery_action: recoveryAction,
        outcome
      }
    });

    const episode = captureEpisodeFromIncident(db, incident.incident_id, outcome);
    json(res, 200, { incident, episode });
  });
}
