import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createMemoryEntity,
  updateMemoryEntity,
  listMemoryEntities,
  getGenomeContext,
  patchMemoryFromChapter,
  checkGenomeConsistency
} from '../lib/memoryEngine.js';
import { evaluateReleaseGate } from '../lib/releaseGate.js';
import { collectActiveIncidents } from '../lib/oodaProcessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-memory') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, schema_version, created_at, updated_at)
    VALUES (?, 'Memory Story', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO chapters (
      workspace_id, chapter_id, title, content, text, status, position, created_at, updated_at
    ) VALUES (?, 'chapter-1', 'Chapter One', 'Mara entered City A.', '', 'Drafted', 0, ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO lindymode_state (
      workspace_id, summary, pov, arc_stage, token_budget, state_json, version, updated_at
    ) VALUES (?, 'Healthy', 'third_person', 'opening', 4000, '{}', 1, ?)
  `).run(workspaceId, now);
  db.prepare(`
    INSERT INTO autonomous_runtime_runs (
      run_id, correlation_id, workspace_id, trigger_type, status,
      steps_json, result_json, created_at, completed_at
    ) VALUES ('run-memory', 'corr-memory', ?, 'test', 'completed', '[]', '{}', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

test('typed Story Memory supports create, list, and update', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const created = createMemoryEntity(db, workspaceId, 'characters', {
    char_id: 'mara',
    name: 'Mara Vale',
    role: 'protagonist',
    status: 'alive',
    location: 'city-a',
    traits: ['resourceful', 'guarded']
  });

  assert.equal(created.char_id, 'mara');
  assert.deepEqual(created.traits, ['resourceful', 'guarded']);

  const updated = updateMemoryEntity(db, workspaceId, 'characters', 'mara', {
    location: 'city-b',
    arc_stage: 'conflict'
  });

  assert.equal(updated.location, 'city-b');
  assert.equal(updated.arc_stage, 'conflict');
  assert.equal(updated.version, 2);
  assert.equal(listMemoryEntities(db, workspaceId, 'characters').length, 1);
  db.close();
});

test('Genome context contains active characters, canonical lore, locations, and timeline', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  createMemoryEntity(db, workspaceId, 'characters', {
    char_id: 'mara', name: 'Mara', role: 'protagonist', status: 'alive'
  });
  createMemoryEntity(db, workspaceId, 'characters', {
    char_id: 'orin', name: 'Orin', role: 'supporting', status: 'dead'
  });
  createMemoryEntity(db, workspaceId, 'lore', {
    lore_id: 'rule-one', category: 'rule', title: 'No return', content: 'The dead cannot return.', canonical: 1
  });
  createMemoryEntity(db, workspaceId, 'locations', {
    loc_id: 'city-a', name: 'City A', type: 'city'
  });
  createMemoryEntity(db, workspaceId, 'timeline', {
    timeline_id: 'day-one', event_label: 'Arrival', story_time: 'Day 1', position: 1
  });

  const context = getGenomeContext(db, workspaceId);

  assert.equal(context.active_characters.length, 1);
  assert.equal(context.active_characters[0].char_id, 'mara');
  assert.equal(context.canonical_lore.length, 1);
  assert.equal(context.locations.length, 1);
  assert.equal(context.timeline.length, 1);
  db.close();
});

test('chapter patch writes a content hash and structured memory diffs', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const rows = patchMemoryFromChapter(db, workspaceId, 1, 'Mara entered City A.', [
    {
      entity_type: 'character',
      entity_id: 'mara',
      field: 'location',
      old_value: 'city-b',
      new_value: 'city-a',
      conflict: true
    }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].field, 'content_hash');
  assert.equal(rows[1].conflict, 1);
  assert.equal(checkGenomeConsistency(db, workspaceId, 1).passed, false);
  db.close();
});

test('Release Gate blocks unresolved Story Memory conflicts', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  patchMemoryFromChapter(db, workspaceId, 1, 'Mara entered City A.', [
    {
      entity_type: 'character',
      entity_id: 'mara',
      field: 'location',
      old_value: 'city-b',
      new_value: 'city-a',
      conflict: true
    }
  ]);

  const gate = evaluateReleaseGate(db, workspaceId, { chapterId: 1 });

  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.metrics.unresolved_genome_conflicts, 1);
  assert.ok(gate.blockers.some(item => item.includes('Story Memory')));
  db.close();
});

test('OODA emits GENOME_DRIFT incidents for unresolved conflicts', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  patchMemoryFromChapter(db, workspaceId, 1, 'Mara entered City A.', [
    {
      entity_type: 'character',
      entity_id: 'mara',
      field: 'location',
      old_value: 'city-b',
      new_value: 'city-a',
      conflict: true
    }
  ]);

  const incidents = collectActiveIncidents(db);
  const genome = incidents.find(item => item.event_type === 'GENOME_DRIFT');

  assert.ok(genome);
  assert.equal(genome.source, 'story_memory');
  assert.equal(genome.workspace_id, workspaceId);
  assert.match(genome.summary, /mara/);
  db.close();
});
