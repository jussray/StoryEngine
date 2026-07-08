// routes/memory.js

import { json } from '../lib/miniRouter.js';
import {
  MEMORY_ENTITY_TYPES,
  getMemorySnapshot,
  listMemoryEntities,
  createMemoryEntity,
  updateMemoryEntity,
  deleteMemoryEntity,
  listMemoryDiffs,
  getGenomeContext
} from '../lib/memoryEngine.js';

function respondError(res, error) {
  const notFound = /not found/i.test(error.message);
  const unknown = /unknown memory entity type/i.test(error.message);
  json(res, notFound ? 404 : unknown ? 400 : 400, { error: error.message });
}

export default function memoryRoutes(router, db) {
  router.get('/api/memory/types', (req, res) => {
    json(res, 200, { types: MEMORY_ENTITY_TYPES });
  });

  router.get('/api/memory/:workspace_id/context', (req, res) => {
    try {
      json(res, 200, getGenomeContext(db, req.params.workspace_id));
    } catch (error) {
      respondError(res, error);
    }
  });

  router.get('/api/memory/:workspace_id/diffs', (req, res) => {
    try {
      json(res, 200, listMemoryDiffs(db, req.params.workspace_id, req.query.limit));
    } catch (error) {
      respondError(res, error);
    }
  });

  router.get('/api/memory/:workspace_id/:type', (req, res) => {
    try {
      json(res, 200, listMemoryEntities(db, req.params.workspace_id, req.params.type));
    } catch (error) {
      respondError(res, error);
    }
  });

  router.get('/api/memory/:workspace_id', (req, res) => {
    try {
      json(res, 200, getMemorySnapshot(db, req.params.workspace_id));
    } catch (error) {
      respondError(res, error);
    }
  });

  router.post('/api/memory/:workspace_id/:type', (req, res) => {
    try {
      const entity = createMemoryEntity(db, req.params.workspace_id, req.params.type, req.body || {});
      json(res, 201, entity);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.put('/api/memory/:workspace_id/:type/:entity_id', (req, res) => {
    try {
      const entity = updateMemoryEntity(
        db,
        req.params.workspace_id,
        req.params.type,
        req.params.entity_id,
        req.body || {}
      );
      if (!entity) return json(res, 404, { error: 'Memory entity not found.' });
      json(res, 200, entity);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.delete('/api/memory/:workspace_id/:type/:entity_id', (req, res) => {
    try {
      const deleted = deleteMemoryEntity(
        db,
        req.params.workspace_id,
        req.params.type,
        req.params.entity_id
      );
      if (!deleted) return json(res, 404, { error: 'Memory entity not found.' });
      json(res, 200, { ok: true, deleted: true });
    } catch (error) {
      respondError(res, error);
    }
  });
}
