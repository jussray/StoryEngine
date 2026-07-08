// routes/audienceLens.js

import { json } from '../lib/miniRouter.js';
import {
  AUDIENCE_LENS_OPTIONS,
  resolveAudienceLens,
  evaluateAudienceFit
} from '../lib/audienceLens.js';

export default function audienceLensRoutes(router) {
  router.get('/api/audience-lenses', (req, res) => {
    json(res, 200, AUDIENCE_LENS_OPTIONS);
  });

  router.get('/api/audience-lenses/:audience', (req, res) => {
    const lens = resolveAudienceLens(req.params.audience);
    if (!lens.active) return json(res, 404, { error: 'Audience lens not found.' });
    json(res, 200, lens);
  });

  router.post('/api/audience-lenses/:audience/evaluate', (req, res) => {
    try {
      json(res, 200, evaluateAudienceFit(req.body?.text || '', req.params.audience));
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });
}
