// routes/lindymode.js

import { json } from '../lib/miniRouter.js';
import * as Lindy from '../models/lindymodeModel.js';
import * as Chapter from '../models/chapterModel.js';
import { analyzeChapter } from '../lib/lindymodeProcessor.js';
import { captureEpisodeFromIncident } from '../lib/learningEngine.js';
import { log } from '../models/eventModel.js';
import { requireWorkspaceAccess, roleAtLeast } from '../lib/securityContext.js';
import { requireInternalController, rejectCallerSelectedControlMode } from '../lib/internalControl.js';

function saveContinuityState(db, workspace_id, body) {
  const state = Lindy.upsertState(db, workspace_id, body || {});
  log(db, {
    workspace_id,
    mode: 'lindymode',
    event_type: 'lindymode.summary_refresh_triggered',
    payload: { state_version: state.version, arc_stage: state.arc_stage, pov: state.pov }
  });
  return state;
}

function resolveContinuityIncident(db, incidentId, body) {
  const recoveryAction = body?.recovery_action || 'manual_state_review';
  const outcome = body?.outcome || 'unknown';
  const incident = Lindy.resolveIncident(db, incidentId, recoveryAction);
  if (!incident) return null;

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
  return { incident, episode };
}

export default function lindymodeRoutes(router, db) {
  // User-facing outcome requests. Callers describe the outcome; the server owns
  // the choice of Lindymode as the internal implementation.
  router.post('/api/intents/check-continuity/:chapter_id', (req, res) => {
    if (rejectCallerSelectedControlMode(req, res)) return;
    const chapter = Chapter.get(db, Number(req.params.chapter_id));
    if (!chapter) return json(res, 404, { error: 'Chapter not found' });
    if (!requireWorkspaceAccess(req, res, chapter.workspace_id)) return;
    json(res, 200, analyzeChapter(db, chapter, {}));
  });

  router.post('/api/intents/update-continuity-state/:workspace_id', (req, res) => {
    if (rejectCallerSelectedControlMode(req, res)) return;
    if (!roleAtLeast(req.auth, 'administrator')) {
      return json(res, 403, { error: 'operator_required', request_id: req.request_id });
    }
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    json(res, 200, saveContinuityState(db, workspace_id, req.body || {}));
  });

  router.post('/api/intents/resolve-continuity-incident/:incident_id', (req, res) => {
    if (rejectCallerSelectedControlMode(req, res)) return;
    const target = Lindy.getIncident(db, req.params.incident_id);
    if (!target) return json(res, 404, { error: 'Incident not found' });
    if (!requireWorkspaceAccess(req, res, target.workspace_id)) return;
    const result = resolveContinuityIncident(db, req.params.incident_id, req.body || {});
    if (!result) return json(res, 404, { error: 'Incident not found' });
    json(res, 200, result);
  });

  // Internal implementation surface. Mode-named endpoints are not user/browser
  // control surfaces and require a scoped administrator service identity.
  router.get('/api/lindymode/state/:workspace_id', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    const state = Lindy.getState(db, req.params.workspace_id);
    json(res, state ? 200 : 404, state || { error: 'Lindymode state not found' });
  });

  router.put('/api/lindymode/state/:workspace_id', (req, res) => {
    if (!requireInternalController(req, res)) return;
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    json(res, 200, saveContinuityState(db, workspace_id, req.body || {}));
  });

  router.post('/api/lindymode/analyze/:chapter_id', (req, res) => {
    if (!requireInternalController(req, res)) return;
    const chapter = Chapter.get(db, Number(req.params.chapter_id));
    if (!chapter) return json(res, 404, { error: 'Chapter not found' });
    if (!requireWorkspaceAccess(req, res, chapter.workspace_id)) return;
    json(res, 200, analyzeChapter(db, chapter, req.body || {}));
  });

  router.get('/api/lindymode/incidents/:workspace_id', (req, res) => {
    if (!requireWorkspaceAccess(req, res, req.params.workspace_id)) return;
    const status = req.query.status || null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    json(res, 200, Lindy.listIncidents(db, req.params.workspace_id, status, limit));
  });

  router.post('/api/lindymode/recover/:incident_id', (req, res) => {
    if (!requireInternalController(req, res)) return;
    const target = Lindy.getIncident(db, req.params.incident_id);
    if (!target) return json(res, 404, { error: 'Incident not found' });
    if (!requireWorkspaceAccess(req, res, target.workspace_id)) return;
    const result = resolveContinuityIncident(db, req.params.incident_id, req.body || {});
    if (!result) return json(res, 404, { error: 'Incident not found' });
    json(res, 200, result);
  });
}
