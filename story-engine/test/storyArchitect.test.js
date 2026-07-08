import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  generateArchitecture,
  validateArchitecture,
  architectureToOutline,
  buildStoryArchitecture,
  getArchitecture
} from '../lib/storyArchitect.js';
import { forgeIdeas } from '../lib/ideaForge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-architect') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, schema_version, created_at, updated_at)
    VALUES (?, 'Architect Story', 'fantasy', 'A guarded hero must choose between safety and truth.', '1.0.0', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

test('Story Architect generates a validated three-act chapter structure', () => {
  const architecture = generateArchitecture({
    title: 'The Hollow Meridian',
    genre: 'fantasy',
    audience: 'young adult readers',
    chapter_count: 12
  });
  const validation = validateArchitecture(architecture);
  const chapters = architecture.acts.flatMap(act => act.chapters);

  assert.equal(architecture.acts.length, 3);
  assert.equal(chapters.length, 12);
  assert.equal(validation.passed, true);
  assert.equal(validation.confidence, 100);
  assert.ok(chapters.some(chapter => /midpoint/i.test(chapter.purpose)));
  assert.ok(chapters.some(chapter => /climax/i.test(chapter.purpose)));
});

test('Story Architect converts structure into a readable outline', () => {
  const architecture = generateArchitecture({ title: 'Salt and Silence', chapter_count: 9 });
  const outline = architectureToOutline(architecture);

  assert.match(outline, /# Salt and Silence/);
  assert.match(outline, /## Act 1: Setup/);
  assert.match(outline, /### Chapter 1:/);
  assert.match(outline, /Emotional hook:/);
});

test('Story Architect persists architecture, outline, genome, and runtime dispatch', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  const [idea] = forgeIdeas(db, {
    workspace_id: workspaceId,
    niche: 'dark fantasy',
    audience: 'young adult readers',
    count: 1
  });

  const result = buildStoryArchitecture(db, {
    workspace_id: workspaceId,
    idea_id: idea.idea_id,
    chapter_count: 12,
    theme: 'Truth costs more than safety.'
  });
  const saved = getArchitecture(db, workspaceId);
  const outline = db.prepare('SELECT * FROM outlines WHERE workspace_id = ?').get(workspaceId);
  const genome = db.prepare('SELECT * FROM story_genomes WHERE workspace_id = ?').get(workspaceId);
  const dispatch = db.prepare(`
    SELECT * FROM runtime_dispatch_queue
    WHERE workspace_id = ? AND trigger_type = 'story_architect_generated'
  `).get(workspaceId);
  const event = db.prepare(`
    SELECT * FROM events
    WHERE workspace_id = ? AND event_type = 'story_architect.validated'
  `).get(workspaceId);

  assert.equal(result.validation.passed, true);
  assert.equal(saved.status, 'validated');
  assert.equal(saved.structure.target_chapter_count, 12);
  assert.match(outline.content, /Act 2: Escalation/);
  assert.equal(JSON.parse(genome.genome_json).architecture.target_chapter_count, 12);
  assert.ok(dispatch);
  assert.ok(event);
  db.close();
});

test('rebuilding architecture increments its version instead of duplicating it', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  buildStoryArchitecture(db, { workspace_id: workspaceId, chapter_count: 9 });
  buildStoryArchitecture(db, { workspace_id: workspaceId, chapter_count: 15 });

  const rows = db.prepare('SELECT * FROM studio_architectures WHERE workspace_id = ?').all(workspaceId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, 2);
  assert.equal(JSON.parse(rows[0].structure_json).target_chapter_count, 15);
  db.close();
});
