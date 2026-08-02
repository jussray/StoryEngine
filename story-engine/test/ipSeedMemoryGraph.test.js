import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { upsertCreativeProfile } from '../lib/creativeProfile.js';
import { buildIpSeed, getIpSeed, ipSeedOverview, proposeSeedUpdate } from '../lib/ipSeedMemoryGraph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function createBook(db) {
  const workspaceId = Story.create(db, {
    title: 'Little Cloud Garden',
    genre: 'educational',
    pitch: 'A shy cloud learns rain helps flowers grow.'
  });
  upsertCreativeProfile(db, workspaceId, {
    story_vision: 'A shy cloud learns rain helps flowers grow.',
    story_kind: 'educational',
    emotional_effect: 'wonder',
    medium: 'picture_book',
    audience: 'eli5',
    goal: 'entertain_and_teach'
  });
  Chapter.create(db, workspaceId, {
    title: 'The Shy Cloud',
    content: 'Cloud hid behind the hill. The garden felt dry. Cloud wondered if rain could help.',
    position: 0
  });
  Chapter.create(db, workspaceId, {
    title: 'Rain Helps',
    content: 'Cloud let soft rain fall. The flowers lifted their faces. Cloud smiled at the garden.',
    position: 1
  });
  return workspaceId;
}

test('IP Seed builds a living memory graph from a validated blueprint', () => {
  const db = createDb();
  const workspaceId = createBook(db);
  const seed = buildIpSeed(db, workspaceId);

  assert.equal(seed.source_workspace_id, workspaceId);
  assert.ok(seed.seed_id.startsWith('seed_'));
  assert.ok(seed.seed.seed_version.startsWith('seed:v'));
  assert.ok(seed.nodes.some(node => node.node_type === 'story'));
  assert.ok(seed.nodes.some(node => node.node_type === 'character'));
  assert.ok(seed.nodes.some(node => node.node_type === 'emotional_beat'));
  assert.ok(seed.nodes.some(node => node.node_type === 'visual_language'));
  assert.ok(seed.edges.length > 0);
  assert.ok(seed.health.score > 0);
  db.close();
});

test('IP Seed can be fetched and summarized for Control Room', () => {
  const db = createDb();
  const workspaceId = createBook(db);
  buildIpSeed(db, workspaceId);

  const fetched = getIpSeed(db, workspaceId);
  const overview = ipSeedOverview(db);

  assert.equal(fetched.title, 'Little Cloud Garden');
  assert.equal(overview.seed_count, 1);
  assert.ok(overview.average_seed_health > 0);
  db.close();
});

test('IP Seed records proposed updates without mutating the validated seed', () => {
  const db = createDb();
  const workspaceId = createBook(db);
  const seed = buildIpSeed(db, workspaceId);
  const updated = proposeSeedUpdate(db, workspaceId, {
    source: 'learning_engine',
    reason: 'Readers loved the rain beat.',
    change: { emphasize_beat: 'Rain Helps' }
  });

  assert.equal(updated.seed_id, seed.seed_id);
  assert.equal(updated.proposal.status, 'proposed');
  const refetched = getIpSeed(db, workspaceId);
  assert.ok(refetched.versions.some(version => version.change_type === 'proposed_update'));
  db.close();
});
