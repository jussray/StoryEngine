import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateIdeas, forgeIdeas, listIdeas, selectIdea } from '../lib/ideaForge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

test('Idea Forge generates scored book ideas', () => {
  const ideas = generateIdeas({ niche: 'teen emotional wellness', audience: 'teen readers', count: 10 });

  assert.equal(ideas.length, 10);
  assert.ok(ideas[0].idea_id);
  assert.ok(ideas[0].title.includes('Teen Emotional Wellness'));
  assert.ok(ideas.every(idea => idea.market_score >= 70 && idea.market_score <= 99));
  assert.ok(ideas.every(idea => idea.originality_score >= 70 && idea.originality_score <= 99));
  assert.ok(ideas.every(idea => idea.series_potential >= 70 && idea.series_potential <= 99));
  assert.ok(ideas.every(idea => idea.movie_potential >= 70 && idea.movie_potential <= 99));
});

test('Idea Forge persists generated ideas and emits an event', () => {
  const db = createDb();
  const ideas = forgeIdeas(db, {
    workspace_id: 'workspace-studio',
    niche: 'cozy fantasy',
    audience: 'romantasy readers',
    count: 4
  });

  const rows = listIdeas(db, { workspace_id: 'workspace-studio' });
  const event = db.prepare(`
    SELECT * FROM events
    WHERE workspace_id = 'workspace-studio' AND event_type = 'idea_forge.generated'
  `).get();

  assert.equal(ideas.length, 4);
  assert.equal(rows.length, 4);
  assert.ok(event);
  db.close();
});

test('Idea Forge selection marks an idea and logs selection', () => {
  const db = createDb();
  const [idea] = forgeIdeas(db, { niche: 'AI storytelling', audience: 'writers', count: 1 });

  const selected = selectIdea(db, idea.idea_id);
  const event = db.prepare(`
    SELECT * FROM events
    WHERE event_type = 'idea_forge.selected'
  `).get();

  assert.equal(selected.selected, 1);
  assert.ok(event);
  db.close();
});

test('Idea Forge bounds count between 1 and 25', () => {
  assert.equal(generateIdeas({ niche: 'memoir', count: 100 }).length, 25);
  assert.equal(generateIdeas({ niche: 'memoir', count: 0 }).length, 10);
});
