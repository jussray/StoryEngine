// routes/memory.js

import { json } from '../lib/miniRouter.js';
import { requireHumanAuthority, roleAtLeast } from '../lib/securityContext.js';
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
import { canonSnapshot, setCanonAnchor } from '../lib/canonMemory.js';
import {
  analyzeStorySource,
  listSourceCanonState,
  reviewSourceProposal,
  SOURCE_CANON_MAX_CHARS
} from '../lib/sourceCanon.js';

function respondError(res, error) {
  const notFound = /not found/i.test(error.message);
  const unknown = /unknown memory entity type/i.test(error.message);
  json(res, notFound ? 404 : unknown ? 400 : 400, { error: error.message });
}

function requireCanonField(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${field} is required for canon.`);
  }
  return String(value).trim();
}

function requireCanonAuthority(req, res) {
  if (!requireHumanAuthority(req, res)) return false;
  if (!roleAtLeast(req.auth, 'creator')) {
    json(res, 403, {
      error: 'canon_role_forbidden',
      required_role: 'creator',
      actor_role: req.auth?.role || null,
      request_id: req.request_id || null
    });
    return false;
  }
  return true;
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

  // Story Universe authority: canon promotion is a human creator decision, not an
  // authenticated-machine or viewer decision. The route therefore requires an
  // explicitly classified human browser session in addition to global auth and
  // workspace access, then checks creator-or-higher role before mutation.
  router.get('/api/memory/:workspace_id/canon', (req, res) => {
    try {
      json(res, 200, canonSnapshot(db, req.params.workspace_id));
    } catch (error) {
      respondError(res, error);
    }
  });

  router.post('/api/memory/:workspace_id/canon', (req, res) => {
    if (!requireCanonAuthority(req, res)) return;
    try {
      const body = req.body || {};
      const anchor = setCanonAnchor(db, {
        workspace_id: req.params.workspace_id,
        kind: requireCanonField(body, 'kind'),
        key: requireCanonField(body, 'key'),
        value: requireCanonField(body, 'value'),
        locked: Boolean(body.locked),
        source: 'human'
      });
      json(res, 201, anchor);
    } catch (error) {
      respondError(res, error);
    }
  });

  // V2.1 source intelligence is deliberately proposal-only. Analysis never writes
  // canon. A human-classified creator session must explicitly approve a proposal
  // before canonMemory runs.
  router.get('/api/memory/:workspace_id/sources', (req, res) => {
    try {
      json(res, 200, {
        ...listSourceCanonState(db, req.params.workspace_id),
        max_source_chars: SOURCE_CANON_MAX_CHARS
      });
    } catch (error) {
      respondError(res, error);
    }
  });

  router.post('/api/memory/:workspace_id/sources/analyze', async (req, res) => {
    try {
      const result = await analyzeStorySource(db, {
        ...(req.body || {}),
        workspace_id: req.params.workspace_id
      });
      json(res, 201, result);
    } catch (error) {
      respondError(res, error);
    }
  });

  router.post('/api/memory/:workspace_id/proposals/:proposal_id/review', (req, res) => {
    if (!requireCanonAuthority(req, res)) return;
    try {
      const result = reviewSourceProposal(db, {
        ...(req.body || {}),
        workspace_id: req.params.workspace_id,
        proposal_id: req.params.proposal_id
      });
      json(res, 200, result);
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
