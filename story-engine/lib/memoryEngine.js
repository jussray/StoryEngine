// lib/memoryEngine.js

import { createHash, randomUUID } from 'node:crypto';

const ENTITY_DEFINITIONS = {
  characters: {
    table: 'memory_characters',
    key: 'char_id',
    required: ['char_id', 'name'],
    writable: ['char_id', 'name', 'role', 'status', 'location', 'arc_stage', 'traits', 'data_json', 'first_chapter', 'last_chapter']
  },
  locations: {
    table: 'memory_locations',
    key: 'loc_id',
    required: ['loc_id', 'name'],
    writable: ['loc_id', 'name', 'type', 'description', 'data_json']
  },
  relationships: {
    table: 'memory_relationships',
    key: 'relationship_id',
    required: ['relationship_id', 'char_a', 'char_b', 'rel_type'],
    writable: ['relationship_id', 'char_a', 'char_b', 'rel_type', 'strength', 'notes']
  },
  lore: {
    table: 'memory_lore',
    key: 'lore_id',
    required: ['lore_id', 'category', 'title', 'content'],
    writable: ['lore_id', 'category', 'title', 'content', 'canonical']
  },
  objects: {
    table: 'memory_objects',
    key: 'obj_id',
    required: ['obj_id', 'name'],
    writable: ['obj_id', 'name', 'type', 'holder', 'location', 'data_json']
  },
  timeline: {
    table: 'memory_timeline',
    key: 'timeline_id',
    required: ['timeline_id', 'event_label', 'story_time'],
    writable: ['timeline_id', 'event_label', 'story_time', 'chapter_id', 'description', 'position']
  }
};

function definition(type) {
  const value = ENTITY_DEFINITIONS[type];
  if (!value) throw new Error(`Unknown memory entity type: ${type}.`);
  return value;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function normalizeJsonFields(input) {
  const output = { ...input };
  for (const key of ['traits', 'data_json']) {
    if (key in output && typeof output[key] !== 'string') output[key] = JSON.stringify(output[key]);
  }
  return output;
}

function hydrate(type, row) {
  if (!row) return null;
  const result = { ...row };
  if (type === 'characters') result.traits = parseJson(row.traits, []);
  if (['characters', 'locations', 'objects'].includes(type)) result.data = parseJson(row.data_json, {});
  return result;
}

function cleanInput(type, input, partial = false) {
  const def = definition(type);
  const source = normalizeJsonFields(input || {});
  const clean = {};
  for (const key of def.writable) {
    if (source[key] !== undefined) clean[key] = source[key];
  }
  if (!partial) {
    for (const key of def.required) {
      if (clean[key] === undefined || clean[key] === null || String(clean[key]).trim() === '') {
        throw new Error(`${key} is required for ${type}.`);
      }
    }
  }
  return clean;
}

export function listMemoryEntities(db, workspaceId, type) {
  const def = definition(type);
  return db.prepare(`SELECT * FROM ${def.table} WHERE workspace_id = ? ORDER BY id`)
    .all(workspaceId).map(row => hydrate(type, row));
}

export function getMemorySnapshot(db, workspaceId) {
  const result = {};
  for (const type of Object.keys(ENTITY_DEFINITIONS)) result[type] = listMemoryEntities(db, workspaceId, type);
  result.diffs = listMemoryDiffs(db, workspaceId, 100);
  return result;
}

export function createMemoryEntity(db, workspaceId, type, input) {
  const def = definition(type);
  const clean = cleanInput(type, input);
  const columns = ['workspace_id', ...Object.keys(clean), 'updated_at'];
  const values = [workspaceId, ...Object.values(clean), Date.now()];
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  return hydrate(type, db.prepare(`SELECT * FROM ${def.table} WHERE workspace_id = ? AND ${def.key} = ?`)
    .get(workspaceId, clean[def.key]));
}

export function updateMemoryEntity(db, workspaceId, type, entityId, input) {
  const def = definition(type);
  const existing = db.prepare(`SELECT * FROM ${def.table} WHERE workspace_id = ? AND ${def.key} = ?`)
    .get(workspaceId, entityId);
  if (!existing) return null;
  const clean = cleanInput(type, input, true);
  delete clean[def.key];
  const entries = Object.entries(clean);
  if (!entries.length) return hydrate(type, existing);
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE ${def.table} SET ${assignments}, version = version + 1, updated_at = ? WHERE workspace_id = ? AND ${def.key} = ?`)
    .run(...entries.map(([, value]) => value), Date.now(), workspaceId, entityId);
  return hydrate(type, db.prepare(`SELECT * FROM ${def.table} WHERE workspace_id = ? AND ${def.key} = ?`)
    .get(workspaceId, entityId));
}

export function deleteMemoryEntity(db, workspaceId, type, entityId) {
  const def = definition(type);
  const result = db.prepare(`DELETE FROM ${def.table} WHERE workspace_id = ? AND ${def.key} = ?`)
    .run(workspaceId, entityId);
  return Number(result.changes || 0) > 0;
}

export function listMemoryDiffs(db, workspaceId, limit = 100) {
  const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
  return db.prepare(`
    SELECT * FROM memory_diffs
    WHERE workspace_id = ?
    ORDER BY conflict DESC, created_at DESC
    LIMIT ?
  `).all(workspaceId, bounded);
}

export function recordMemoryDiff(db, input) {
  const diffId = input.diff_id || randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO memory_diffs (
      diff_id, workspace_id, chapter_id, entity_type, entity_id, field,
      old_value, new_value, conflict, resolved, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    diffId, input.workspace_id, input.chapter_id ?? null, input.entity_type,
    input.entity_id, input.field, input.old_value ?? null, input.new_value ?? null,
    input.conflict ? 1 : 0, input.source || 'system', now
  );
  return db.prepare('SELECT * FROM memory_diffs WHERE diff_id = ?').get(diffId);
}

export function patchMemoryFromChapter(db, workspaceId, chapterId, chapterText, patches = []) {
  const text = String(chapterText || '');
  const hash = createHash('sha256').update(text).digest('hex');
  const changes = Array.isArray(patches) ? patches : [];
  const rows = [];

  const apply = db.transaction(() => {
    const already = db.prepare(`
      SELECT id
      FROM memory_diffs
      WHERE workspace_id = ?
        AND chapter_id = ?
        AND field = 'content_hash'
        AND new_value = ?
      LIMIT 1
    `).get(workspaceId, chapterId, hash);

    if (already) return;

    rows.push(recordMemoryDiff(db, {
      workspace_id: workspaceId,
      chapter_id: chapterId,
      entity_type: 'chapter',
      entity_id: `chapter:${chapterId}`,
      field: 'content_hash',
      new_value: hash,
      conflict: false,
      source: 'chapter_save'
    }));

    for (const patch of changes) {
      rows.push(recordMemoryDiff(db, {
        ...patch,
        workspace_id: workspaceId,
        chapter_id: chapterId,
        source: patch.source || 'chapter_patch'
      }));
    }
  });

  apply();
  return rows;
}

export function getGenomeContext(db, workspaceId) {
  return {
    active_characters: db.prepare(`
      SELECT char_id, name, role, status, location, arc_stage, traits
      FROM memory_characters
      WHERE workspace_id = ? AND status != 'dead'
      ORDER BY role, name
    `).all(workspaceId).map(row => ({ ...row, traits: parseJson(row.traits, []) })),
    canonical_lore: db.prepare(`
      SELECT lore_id, category, title, content
      FROM memory_lore
      WHERE workspace_id = ? AND canonical = 1
      ORDER BY category, title
      LIMIT 50
    `).all(workspaceId),
    locations: db.prepare(`
      SELECT loc_id, name, type, description
      FROM memory_locations WHERE workspace_id = ? ORDER BY name
    `).all(workspaceId),
    timeline: db.prepare(`
      SELECT timeline_id, event_label, story_time, chapter_id, position
      FROM memory_timeline WHERE workspace_id = ? ORDER BY position, id
      LIMIT 100
    `).all(workspaceId),
    as_of: Date.now()
  };
}

export function checkGenomeConsistency(db, workspaceId, chapterId = null) {
  const rows = chapterId == null
    ? db.prepare(`SELECT * FROM memory_diffs WHERE workspace_id = ? AND conflict = 1 AND resolved = 0 ORDER BY created_at DESC`).all(workspaceId)
    : db.prepare(`SELECT * FROM memory_diffs WHERE workspace_id = ? AND chapter_id = ? AND conflict = 1 AND resolved = 0 ORDER BY created_at DESC`).all(workspaceId, chapterId);
  return { passed: rows.length === 0, conflicts: rows };
}

export const MEMORY_ENTITY_TYPES = Object.freeze(Object.keys(ENTITY_DEFINITIONS));
