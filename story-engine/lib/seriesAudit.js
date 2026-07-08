// lib/seriesAudit.js

import { randomUUID } from 'node:crypto';
import * as Chapter from '../models/chapterModel.js';
import { log } from '../models/eventModel.js';
import { extractEntities, extractionToPatches } from './extractEntities.js';
import { patchMemoryFromChapter, getMemorySnapshot, checkGenomeConsistency } from './memoryEngine.js';
import { evaluateReleaseGate } from './releaseGate.js';

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function bounded(value, fallback, min, max) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function splitManuscript(manuscript, options = {}) {
  const raw = String(manuscript || '').trim();
  if (!raw) throw new Error('manuscript is required.');
  const maxChars = bounded(options.max_chars_per_chunk, 18000, 4000, 60000);
  const chapterMatches = [...raw.matchAll(/(?:^|\n)(?:chapter|part)\s+([\w\d -]+)\s*\n/gi)];

  if (chapterMatches.length > 1) {
    return chapterMatches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = chapterMatches[index + 1]?.index ?? raw.length;
      return {
        label: `Chapter ${match[1].trim()}`,
        text: raw.slice(start, end).trim()
      };
    }).filter(item => item.text);
  }

  const chunks = [];
  for (let cursor = 0; cursor < raw.length; cursor += maxChars) {
    chunks.push({ label: `Chunk ${chunks.length + 1}`, text: raw.slice(cursor, cursor + maxChars).trim() });
  }
  return chunks.filter(item => item.text);
}

function ensureChapter(db, workspaceId, chunk, index) {
  const chapterId = `audit-${String(index + 1).padStart(3, '0')}`;
  const existing = db.prepare('SELECT * FROM chapters WHERE workspace_id = ? AND chapter_id = ?')
    .get(workspaceId, chapterId);
  if (existing) {
    Chapter.update(db, existing.id, { title: chunk.label, content: chunk.text, position: index + 1 });
    return Chapter.get(db, existing.id);
  }
  const id = Number(Chapter.create(db, workspaceId, {
    title: chunk.label,
    content: chunk.text,
    position: index + 1
  }));
  db.prepare('UPDATE chapters SET chapter_id = ? WHERE id = ?').run(chapterId, id);
  return Chapter.get(db, id);
}

function summarizeConflicts(conflicts) {
  const byType = new Map();
  for (const conflict of conflicts) {
    const key = conflict.entity_type || 'unknown';
    byType.set(key, (byType.get(key) || 0) + 1);
  }
  return [...byType.entries()].map(([type, count]) => ({ type, count }));
}

export async function runSeriesContinuityAudit(db, input = {}) {
  const startedAt = Date.now();
  const workspaceId = text(input.workspace_id);
  if (!workspaceId) throw new Error('workspace_id is required.');
  const story = db.prepare('SELECT * FROM stories WHERE workspace_id = ?').get(workspaceId);
  if (!story) throw new Error('Workspace not found.');

  const auditId = randomUUID();
  const chunks = splitManuscript(input.manuscript, input);
  const extractionProvider = input.provider || process.env.ENTITY_EXTRACT_PROVIDER || 'auto';
  const chapters = [];
  const extractions = [];
  const patchResults = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chapter = ensureChapter(db, workspaceId, chunks[index], index);
    const extraction = await extractEntities(chunks[index].text, {
      provider: extractionProvider === 'auto' ? undefined : extractionProvider,
      chapter_label: chunks[index].label,
      model: input.model
    });
    const patches = extractionToPatches(extraction);
    const rows = patchMemoryFromChapter(db, workspaceId, chapter.id, chunks[index].text, patches);
    chapters.push(chapter);
    extractions.push({ chapter_id: chapter.id, chapter_label: chunks[index].label, extraction, patch_count: patches.length });
    patchResults.push({ chapter_id: chapter.id, inserted_diffs: rows.length, proposed_patches: patches.length });
  }

  const memory = getMemorySnapshot(db, workspaceId);
  const genome = checkGenomeConsistency(db, workspaceId);
  const releaseGate = evaluateReleaseGate(db, workspaceId);
  const conflicts = genome.conflicts;
  const duration = Date.now() - startedAt;

  log(db, {
    workspace_id: workspaceId,
    mode: 'series_audit',
    event_type: conflicts.length ? 'series_audit.conflicts_found' : 'series_audit.clean',
    payload: {
      audit_id: auditId,
      chunks: chunks.length,
      chapters: chapters.length,
      conflicts: conflicts.length,
      conflict_summary: summarizeConflicts(conflicts),
      provider: extractionProvider
    },
    duration_ms: duration,
    rollback: conflicts.length ? 1 : 0
  });

  return {
    audit_id: auditId,
    workspace_id: workspaceId,
    title: story.title,
    provider: extractionProvider,
    duration_ms: duration,
    manuscript: {
      chunks: chunks.length,
      characters: String(input.manuscript || '').length
    },
    world_model: {
      characters: memory.characters.length,
      locations: memory.locations.length,
      relationships: memory.relationships.length,
      lore: memory.lore.length,
      objects: memory.objects.length,
      timeline: memory.timeline.length
    },
    conflict_count: conflicts.length,
    conflict_summary: summarizeConflicts(conflicts),
    conflicts,
    chapters: patchResults,
    extractions,
    release_gate: releaseGate,
    generated_at: Date.now()
  };
}
