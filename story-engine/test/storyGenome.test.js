import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildStoryGenome,
  getStoryGenome,
  getStoryGenomeVersion,
  listStoryGenomeVersions
} from '../lib/storyGenome.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedStory(db, workspaceId = 'workspace-genome-history') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (
      workspace_id, title, genre, pitch, tenant_id, created_by_actor_id,
      schema_version, created_at, updated_at
    ) VALUES (?, 'Genome History', 'fantasy', 'A story that must preserve its own lineage.',
      'tenant-test', 'actor-test', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  db.prepare(`
    INSERT INTO chapters (workspace_id, chapter_id, title, content, position, created_at, updated_at)
    VALUES (?, 'chapter-1', 'Opening', 'Nia waits.', 0, ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

test('Story Genome keeps immutable historical snapshots when the current genome changes', () => {
  const db = createDb();
  const workspaceId = seedStory(db);

  const first = buildStoryGenome(db, workspaceId);
  assert.equal(first.version, 1);
  assert.match(first.genome_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.narrative.total_words, 2);

  db.prepare(`
    UPDATE chapters
    SET content = 'Nia waits beside the moonlit gate.', updated_at = ?
    WHERE workspace_id = ? AND chapter_id = 'chapter-1'
  `).run(Date.now(), workspaceId);

  const second = buildStoryGenome(db, workspaceId);
  assert.equal(second.version, 2);
  assert.notEqual(second.genome_hash, first.genome_hash);
  assert.equal(second.narrative.total_words, 6);

  const current = getStoryGenome(db, workspaceId);
  const original = getStoryGenomeVersion(db, workspaceId, 1);
  const versions = listStoryGenomeVersions(db, workspaceId);

  assert.equal(current.version, 2);
  assert.equal(current.genome_hash, second.genome_hash);
  assert.equal(original.version, 1);
  assert.equal(original.genome_hash, first.genome_hash);
  assert.equal(original.narrative.total_words, 2);
  assert.deepEqual(versions.map(item => item.version), [2, 1]);

  db.close();
});

test('first write preserves a pre-existing current genome as a legacy history snapshot before overwrite', () => {
  const db = createDb();
  const workspaceId = seedStory(db, 'workspace-legacy-genome');
  const legacy = {
    workspace_id: workspaceId,
    identity: { title: 'Legacy Genome' },
    narrative: { total_words: 1 }
  };
  db.prepare(`
    INSERT INTO story_genomes (workspace_id, genome_json, version, updated_at)
    VALUES (?, ?, 7, ?)
  `).run(workspaceId, JSON.stringify(legacy), 1234);

  const next = buildStoryGenome(db, workspaceId);
  assert.equal(next.version, 8);

  const preserved = getStoryGenomeVersion(db, workspaceId, 7);
  assert.equal(preserved.identity.title, 'Legacy Genome');
  assert.equal(preserved.narrative.total_words, 1);
  assert.equal(preserved.updated_at, 1234);

  const rows = db.prepare(`
    SELECT version, source FROM story_genome_versions
    WHERE workspace_id = ?
    ORDER BY version
  `).all(workspaceId);
  assert.deepEqual(rows, [
    { version: 7, source: 'legacy_current_backfill' },
    { version: 8, source: 'story_genome.refresh' }
  ]);

  db.close();
});
