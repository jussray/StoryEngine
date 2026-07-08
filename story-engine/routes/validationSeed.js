// routes/validationSeed.js

import { json } from '../lib/miniRouter.js';
import {
  VALIDATION_SEED_TYPES,
  getValidationSeedProfile,
  seedProofChecklist
} from '../lib/validationSeed.js';

export default function validationSeedRoutes(router) {
  router.get('/api/validation-seeds/options', (req, res) => {
    json(res, 200, {
      seed_types: VALIDATION_SEED_TYPES,
      principle: 'Any validated finished work can become the seed asset for future adaptations.'
    });
  });

  router.get('/api/validation-seeds/:medium', (req, res) => {
    const profile = getValidationSeedProfile(req.params.medium);
    json(res, 200, {
      ...profile,
      checklist: seedProofChecklist(profile)
    });
  });
}
