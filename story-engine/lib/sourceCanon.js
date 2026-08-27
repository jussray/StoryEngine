// lib/sourceCanon.js
// V2.1 source -> understand -> canonize membrane.
// Extraction can propose story truth. Only an explicit human review may promote it to canon.

import { createHash, randomUUID } from 'node:crypto';
import './sqliteTransaction.js';
import { extractEntities } from './extractEntities.js';
import { getCanonAnchor, setCanonAnchor } from './canonMemory.js';
import { log } from '../models/eventModel.js';

const MAX_SOURCE_CHARS = Number(process.env.STORY_SOURCE_MAX_CHARS || 60_000);
const VALID_DECISIONS = new Set(['approve', 'reject']);

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'text',
      title TEXT NOT NULL DEFAULT 'Untitled source',
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'analyzing',
      extractor TEXT,
      analysis_note TEXT,
      created_at INTEGER NOT NULL,
      analyzed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_story_sources_workspace
      ON story_sources(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS source_canon_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      evidence TEXT,
      confidence REAL,
      extractor TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      locked INTEGER NOT NULL DEFAULT 1,
      canon_anchor_id TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      FOREIGN KEY(source_id) REFERENCES story_sources(source_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_source_proposals_workspace
      ON source_canon_proposals(workspace_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_proposals_source
      ON source_canon_proposals(source_id, created_at);
  `);
}

function cleanText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function boundedSource(value) {
  const content = cleanText(value);
  if (!content) throw new Error('content is required for source analysis.');
  if (content.length > MAX_SOURCE_CHARS) {
    throw new Error(`Source exceeds the ${MAX_SOURCE_CHARS} character V2.1 limit.`);
  }
  return content;
}

function contentHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function slug(value, fallback = 'fact') {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100) || fallback;
}

function firstEvidence(content, needle) {
  const sentences = String(content)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(item => item.trim())
    .filter(Boolean);
  const match = sentences.find(sentence => sentence.toLowerCase().includes(String(needle || '').toLowerCase()));
  return (match || sentences[0] || '').slice(0, 800);
}

function sourceInsights(content) {
  const sentences = String(content)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(item => item.trim())
    .filter(Boolean);

  return sentences
    .filter(sentence => /\b(realized|learned|because|meant|afraid|scared|always|never|promise|secret|truth)\b/i.test(sentence))
    .slice(0, 6)
    .map(sentence => ({
      kind: 'lore',
      key: `source.insight.${contentHash(sentence).slice(0, 10)}`,
      value: sentence,
      evidence: sentence,
      confidence: 0.65
    }));
}

function proposalsFromExtraction(extraction, content) {
  const proposals = [];

  for (const character of extraction.characters || []) {
    proposals.push({
      kind: 'character',
      key: `character.${slug(character.id || character.name, 'unknown')}.name`,
      value: cleanText(character.name, 'Unnamed character'),
      evidence: firstEvidence(content, character.name),
      confidence: 0.85
    });
  }

  for (const location of extraction.locations || []) {
    const detail = cleanText(location.description || location.type);
    proposals.push({
      kind: 'lore',
      key: `location.${slug(location.id || location.name, 'unknown')}`,
      value: detail ? `${location.name}: ${detail}` : location.name,
      evidence: firstEvidence(content, location.name),
      confidence: 0.80
    });
  }

  for (const lore of extraction.lore || []) {
    proposals.push({
      kind: lore.category === 'world_rule' ? 'world_rule' : 'lore',
      key: `lore.${slug(lore.id || lore.title || contentHash(lore.content).slice(0, 10), 'fact')}`,
      value: lore.content,
      evidence: lore.content,
      confidence: 0.90
    });
  }

  for (const item of extraction.timeline || []) {
    proposals.push({
      kind: 'lore',
      key: `timeline.${slug(item.id || item.label, 'event')}`,
      value: cleanText(item.description || item.label),
      evidence: firstEvidence(content, item.label),
      confidence: 0.75
    });
  }

  for (const relationship of extraction.relationships || []) {
    proposals.push({
      kind: 'lore',
      key: `relationship.${slug(relationship.id, 'relationship')}`,
      value: `${relationship.char_a} is ${relationship.type} ${relationship.char_b}`,
      evidence: cleanText(relationship.notes) || firstEvidence(content, relationship.char_a),
      confidence: 0.75
    });
  }

  for (const object of extraction.objects || []) {
    const ownership = object.holder ? `; holder: ${object.holder}` : '';
    const location = object.location ? `; location: ${object.location}` : '';
    proposals.push({
      kind: 'lore',
      key: `object.${slug(object.id || object.name, 'object')}`,
      value: `${object.name}${ownership}${location}`,
      evidence: firstEvidence(content, object.name),
      confidence: 0.75
    });
  }

  proposals.push(...sourceInsights(content));

  const seen = new Set();
  return proposals.filter(item => {
    const dedupeKey = `${item.kind}\u0000${item.key}\u0000${item.value}`;
    if (!item.value || seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  }).slice(0, 40);
}

function hydrateProposal(row) {
  if (!row) return null;
  return { ...row, locked: Boolean(row.locked) };
}

export function listSourceCanonState(db, workspaceId) {
  ensureSchema(db);
  const sources = db.prepare(`
    SELECT source_id, workspace_id, source_type, title, content_hash, status, extractor,
           analysis_note, created_at, analyzed_at
    FROM story_sources
    WHERE workspace_id=?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(workspaceId);

  const proposals = db.prepare(`
    SELECT proposal_id, source_id, workspace_id, kind, key, value, evidence, confidence,
           extractor, status, locked, canon_anchor_id, created_at, reviewed_at
    FROM source_canon_proposals
    WHERE workspace_id=?
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 200
  `).all(workspaceId).map(hydrateProposal);

  return {
    workspace_id: workspaceId,
    sources,
    proposals,
    counts: {
      sources: sources.length,
      pending: proposals.filter(item => item.status === 'pending').length,
      approved: proposals.filter(item => item.status === 'approved').length,
      rejected: proposals.filter(item => item.status === 'rejected').length
    }
  };
}

export async function analyzeStorySource(db, input = {}) {
  ensureSchema(db);
  const workspaceId = cleanText(input.workspace_id);
  if (!workspaceId) throw new Error('workspace_id is required for source analysis.');
  const content = boundedSource(input.content);
  const sourceId = `source_${randomUUID()}`;
  const now = Date.now();
  const requestedProvider = cleanText(input.provider || process.env.SOURCE_CANON_PROVIDER);

  db.prepare(`
    INSERT INTO story_sources (
      source_id, workspace_id, source_type, title, content, content_hash, status,
      extractor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'analyzing', ?, ?)
  `).run(
    sourceId,
    workspaceId,
    cleanText(input.source_type, 'text'),
    cleanText(input.title, 'Untitled source'),
    content,
    contentHash(content),
    requestedProvider || 'auto',
    now
  );

  let extraction;
  let analysisNote = null;
  try {
    extraction = await extractEntities(content, requestedProvider ? { provider: requestedProvider, chapter_label: input.title } : { chapter_label: input.title });
  } catch (error) {
    if (requestedProvider && requestedProvider !== 'local') {
      db.prepare(`UPDATE story_sources SET status='failed', analysis_note=?, analyzed_at=? WHERE source_id=?`)
        .run(String(error.message || error).slice(0, 500), Date.now(), sourceId);
      throw error;
    }
    analysisNote = `model_unavailable_local_fallback: ${String(error.message || error).slice(0, 300)}`;
    extraction = await extractEntities(content, { provider: 'local', chapter_label: input.title });
  }

  const proposals = proposalsFromExtraction(extraction, content);
  const extractor = extraction.source || requestedProvider || 'local_heuristic';
  const analyzedAt = Date.now();

  const commit = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO source_canon_proposals (
        proposal_id, source_id, workspace_id, kind, key, value, evidence, confidence,
        extractor, status, locked, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)
    `);
    const rows = [];
    for (const proposal of proposals) {
      const proposalId = `proposal_${randomUUID()}`;
      insert.run(
        proposalId, sourceId, workspaceId, proposal.kind, proposal.key, proposal.value,
        proposal.evidence || null, proposal.confidence ?? null, extractor, analyzedAt
      );
      rows.push(hydrateProposal(db.prepare('SELECT * FROM source_canon_proposals WHERE proposal_id=?').get(proposalId)));
    }

    db.prepare(`
      UPDATE story_sources
      SET status='review_ready', extractor=?, analysis_note=?, analyzed_at=?
      WHERE source_id=?
    `).run(extractor, analysisNote, analyzedAt, sourceId);

    log(db, {
      workspace_id: workspaceId,
      mode: 'story_universe',
      event_type: 'source.analysis.review_ready',
      payload: { source_id: sourceId, extractor, proposal_count: rows.length }
    });
    return rows;
  });

  const rows = commit();
  return {
    source_id: sourceId,
    workspace_id: workspaceId,
    status: 'review_ready',
    extractor,
    analysis_note: analysisNote,
    proposal_count: rows.length,
    proposals: rows
  };
}

export function reviewSourceProposal(db, input = {}) {
  ensureSchema(db);
  const workspaceId = cleanText(input.workspace_id);
  const proposalId = cleanText(input.proposal_id);
  const decision = cleanText(input.decision).toLowerCase();
  if (!workspaceId || !proposalId) throw new Error('workspace_id and proposal_id are required.');
  if (!VALID_DECISIONS.has(decision)) throw new Error('decision must be approve or reject.');

  const proposal = db.prepare(`
    SELECT * FROM source_canon_proposals WHERE proposal_id=? AND workspace_id=?
  `).get(proposalId, workspaceId);
  if (!proposal) throw new Error('Source proposal not found.');
  if (proposal.status !== 'pending') throw new Error(`Source proposal is already ${proposal.status}.`);

  if (decision === 'reject') {
    const reviewedAt = Date.now();
    db.prepare(`
      UPDATE source_canon_proposals SET status='rejected', reviewed_at=? WHERE proposal_id=?
    `).run(reviewedAt, proposalId);
    log(db, {
      workspace_id: workspaceId,
      mode: 'story_universe',
      event_type: 'source.proposal.rejected',
      payload: { proposal_id: proposalId, source_id: proposal.source_id }
    });
    return hydrateProposal(db.prepare('SELECT * FROM source_canon_proposals WHERE proposal_id=?').get(proposalId));
  }

  const finalKind = cleanText(input.kind, proposal.kind);
  const finalKey = cleanText(input.key, proposal.key);
  const finalValue = cleanText(input.value, proposal.value);
  if (!finalKind || !finalKey || !finalValue) throw new Error('Approved canon requires kind, key, and value.');

  const existingAnchor = getCanonAnchor(db, workspaceId, finalKind, finalKey);
  let createLocked;
  if (existingAnchor) {
    if (input.locked !== undefined && Boolean(input.locked) !== Boolean(existingAnchor.locked)) {
      throw new Error('Proposal approval cannot change an existing canon lock; use the dedicated evidence-backed lock path.');
    }
    createLocked = undefined;
  } else {
    createLocked = input.locked === undefined ? Boolean(proposal.locked) : Boolean(input.locked);
  }
  const reviewedAt = Date.now();

  const promote = db.transaction(() => {
    const anchor = setCanonAnchor(db, {
      workspace_id: workspaceId,
      kind: finalKind,
      key: finalKey,
      value: finalValue,
      locked: createLocked,
      source: 'human',
      evidence: input.evidence || null,
      authority_grant: input.authority_grant || null
    });
    db.prepare(`
      UPDATE source_canon_proposals
      SET kind=?, key=?, value=?, locked=?, status='approved', canon_anchor_id=?, reviewed_at=?
      WHERE proposal_id=?
    `).run(finalKind, finalKey, finalValue, anchor.locked ? 1 : 0, anchor.anchor_id, reviewedAt, proposalId);
    log(db, {
      workspace_id: workspaceId,
      mode: 'story_universe',
      event_type: 'source.proposal.approved_to_canon',
      payload: {
        proposal_id: proposalId,
        source_id: proposal.source_id,
        anchor_id: anchor.anchor_id,
        kind: finalKind,
        key: finalKey,
        locked: Boolean(anchor.locked)
      }
    });
    return anchor;
  });

  const anchor = promote();
  return {
    proposal: hydrateProposal(db.prepare('SELECT * FROM source_canon_proposals WHERE proposal_id=?').get(proposalId)),
    canon_anchor: anchor
  };
}

export const SOURCE_CANON_MAX_CHARS = MAX_SOURCE_CHARS;
