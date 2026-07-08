// routes/movie.js
import { json } from '../lib/miniRouter.js';
import * as Movie from '../models/movieModel.js';
import { log } from '../models/eventModel.js';
import {
  createReleaseAttempt,
  completeReleaseAttempt,
  failReleaseAttempt
} from '../lib/releaseAttempts.js';

export default function movieRoutes(router, db) {
  router.get('/api/movie/beats/:workspace_id', (req, res) => {
    json(res, 200, Movie.listBeats(db, req.params.workspace_id));
  });

  router.post('/api/movie/beats/generate/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const release = createReleaseAttempt(db, workspace_id, 'movie_beats_generate', {
      allowWarning: req.body?.allow_warning === true
    });

    if (!release) return json(res, 404, { error: 'Workspace not found' });
    if (!release.allowed) {
      return json(res, 409, {
        error: release.error,
        attempt: release.attempt,
        gate: release.gate
      });
    }

    const t0 = Date.now();
    try {
      const beats = Movie.generateBeats(db, workspace_id);
      log(db, {
        workspace_id,
        mode: 'movie',
        event_type: 'beats_generated',
        payload: {
          count: beats.length,
          release_attempt_id: release.attempt.attempt_id,
          release_gate_audit_id: release.gate.audit_id
        },
        duration_ms: Date.now() - t0
      });

      const attempt = completeReleaseAttempt(db, release.attempt.attempt_id, {
        beat_count: beats.length,
        duration_ms: Date.now() - t0
      });

      json(res, 200, { beats, gate: release.gate, attempt });
    } catch (error) {
      const attempt = failReleaseAttempt(db, release.attempt.attempt_id, error);
      json(res, 500, { error: error.message, attempt, gate: release.gate });
    }
  });

  router.put('/api/movie/beats/:id', (req, res) => {
    const id = Number(req.params.id);
    const { logline } = req.body || {};
    const t0 = Date.now();
    Movie.updateBeat(db, id, { logline });
    log(db, {
      workspace_id: req.body.workspace_id || 'unknown',
      mode: 'movie',
      event_type: 'beat_updated',
      duration_ms: Date.now() - t0
    });
    json(res, 200, { ok: true });
  });
}
