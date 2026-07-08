// routes/bootstrapEngine.js

import { json } from '../lib/miniRouter.js';
import { requireRole } from '../lib/securityContext.js';
import {
  DEFAULT_BOOTSTRAP_PROVIDERS,
  listBootstrapProviders,
  updateBootstrapProvider,
  evaluateBootstrapStack,
  founderEconomicsOverview
} from '../lib/bootstrapEngine.js';

export default function bootstrapEngineRoutes(router, db) {
  router.get('/api/bootstrap-engine/options', (req, res) => {
    json(res, 200, {
      providers: DEFAULT_BOOTSTRAP_PROVIDERS,
      principle: 'Being broke is the Lindy filter: stay free until reliability, quality, or revenue justifies spending.',
      write_roles: {
        update_provider: 'administrator',
        persist_evaluation: 'reviewer+'
      }
    });
  });

  router.get('/api/bootstrap-engine/providers', (req, res) => {
    try { json(res, 200, listBootstrapProviders(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });

  router.put('/api/bootstrap-engine/providers/:category', (req, res) => {
    requireRole('administrator')(req, res, () => {
      try { json(res, 200, updateBootstrapProvider(db, req.params.category, req.body || {})); }
      catch (error) { json(res, /unknown/i.test(error.message) ? 404 : 400, { error: error.message }); }
    });
  });

  router.post('/api/bootstrap-engine/evaluate', (req, res) => {
    requireRole('reviewer')(req, res, () => {
      try { json(res, 201, evaluateBootstrapStack(db, { persist: true })); }
      catch (error) { json(res, 500, { error: error.message }); }
    });
  });

  router.get('/api/bootstrap-engine/overview', (req, res) => {
    try { json(res, 200, founderEconomicsOverview(db)); }
    catch (error) { json(res, 500, { error: error.message }); }
  });
}
