// routes/memory.js

import { json } from '../lib/miniRouter.js';
import { issueCanonAuthorityGrant, requireHumanAuthority, roleAtLeast } from '../lib/securityContext.js';
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
import { createCanonEvidence } from '../lib/canonEvidence.js';
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

function canonOverride(value, fallback) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function requireCanonReviewer(req) {
  const actorId = String(req.auth?.actor_id || '').trim();
  if (!actorId) throw new Error('Authenticated human actor_id is required for canon evidence.');
  return actorId;
}

function directCanonEvidence(req, { workspace_id, kind, key, value }) {
  const reviewer = requireCanonReviewer(req);
  const requestId = String(req.request_id || '').trim();
  return createCanonEvidence({
    workspace_id,
    kind,
    key,
    statement: value,
    source_ref: `direct-entry:reviewer:${reviewer}`,
    source_version: requestId ? `request:${requestId}` : null,
    authority: 'human'
  });
}

function proposalCanonEvidence(req, db, workspaceId, proposalId, body) {
  const proposal = db.prepare(`
    SELECT proposal_id, source_id, workspace_id, kind, key, value, confidence
    FROM source_canon_proposals
    WHERE proposal_id=? AND workspace_id=?
  `).get(proposalId, workspaceId);
  if (!proposal) throw new Error('Source proposal not found.');

  const source = db.prepare(`
    SELECT source_id, content_hash
    FROM story_sources
    WHERE source_id=? AND workspace_id=?
  `).get(proposal.source_id, workspaceId);
  if (!source?.content_hash) {
    throw new Error('Source proposal cannot be approved without its immutable source hash.');
  }

  const reviewer = requireCanonReviewer(req);
  const kind = canonOverride(body?.kind, proposal.kind);
  const key = canonOverride(body?.key, proposal.key);
  const value = canonOverride(body?.value, proposal.value);

  return createCanonEvidence({
    workspace_id: workspaceId,
    kind,
    key,
    statement: value,
    source_ref: `source:${proposal.source_id};proposal:${proposal.proposal_id};reviewer:${reviewer}`,
    source_version: `sha256:${source.content_hash}`,
    authority: 'human',
    confidence: proposal.confidence
  });
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
      const workspaceId = req.params.workspace_id;
      const kind = requireCanonField(body, 'kind');
      const key = requireCanonField(body, 'key');
      const value = requireCanonField(body, 'value');
      const evidence = directCanonEvidence(req, {
        workspace_id: workspaceId,
        kind,
        key,
        value
      });
      const authorityGrant = issueCanonAuthorityGrant(req, workspaceId);
      const anchor = setCanonAnchor(db, {
        workspace_id: workspaceId,
        kind,
        key,
        value,
        locked: body.locked === undefined ? undefined : Boolean(body.locked),
        source: 'human',
        evidence,
        authority_grant: authorityGrant
      });
      json(res, 201, anchor);
    } catch (error) {
      respondError(res, error);
    }
  });

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
      const body = req.body || {};
      const workspaceId = req.params.workspace_id;
      const proposalId = req.params.proposal_id;
      const input = {
        ...body,
        workspace_id: workspaceId,
        proposal_id: proposalId
      };
      if (String(body.decision || '').trim().toLowerCase() === 'approve') {
        input.evidence = proposalCanonEvidence(req, db, workspaceId, proposalId, body);
        input.authority_grant = issueCanonAuthorityGrant(req, workspaceId);
      }
      const result = reviewSourceProposal(db, input);
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
