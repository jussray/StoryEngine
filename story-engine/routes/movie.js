// routes/movie.js
import { json } from '../lib/miniRouter.js';
import * as Movie from '../models/movieModel.js';
import { log } from '../models/eventModel.js';

export default function movieRoutes(router, db) {
  router.get('/api/movie/beats/:workspace_id', (req, res) => {
    json(res, 200, Movie.listBeats(db, req.params.workspace_id));
  });

  router.post('/api/movie/beats/generate/:workspace_id', (req, res) => {
    const { workspace_id } = req.params;
    const t0 = Date.now();
    const beats = Movie.generateBeats(db, workspace_id);
    log(db, { workspace_id, mode: 'movie', event_type: 'beats_generated', payload: { count: beats.length }, duration_ms: Date.now() - t0 });
    json(res, 200, beats);
  });

  router.put('/api/movie/beats/:id', (req, res) => {
    const id = Number(req.params.id);
    const { logline } = req.body || {};
    const t0 = Date.now();
    Movie.updateBeat(db, id, { logline });
    log(db, { workspace_id: req.body.workspace_id || 'unknown', mode: 'movie', event_type: 'beat_updated', duration_ms: Date.now() - t0 });
    json(res, 200, { ok: true });
  });
}
