import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { upsertCreativeProfile } from '../lib/creativeProfile.js';
import { evaluateIpGrowth, getLatestIpGrowth, listIpGrowthActions, startIpExpansion } from '../lib/ipGrowthEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function createBook(db) {
  const workspaceId = Story.create(db, {
    title: 'The Little Cloud Garden',
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

test('IP Growth Engine ranks source-specific next expansions', () => {
  const db = createDb();
  const workspaceId = createBook(db);
  const result = evaluateIpGrowth(db, workspaceId);

  assert.equal(result.status, 'ready');
  assert.ok(result.growth_score > 0);
  assert.ok(result.readiness_score > 0);
  assert.equal(result.recommended_next.target_medium, 'youtube_short');
  assert.equal(result.recommended_next.recommendation, 'build_next');
  assert.equal(result.principle.includes('validated IP'), true);

  const stored = getLatestIpGrowth(db, workspaceId);
  assert.equal(stored.workspace_id, workspaceId);
  assert.ok(stored.recommendations.length > 0);
  db.close();
});

test('IP Growth Engine starts expansion through existing seed-gated conversion', () => {
  const db = createDb();
  const workspaceId = createBook(db);
  const action = startIpExpansion(db, workspaceId, 'youtube_short');

  assert.equal(action.recommendation.target_medium, 'youtube_short');
  assert.ok(action.conversion.conversion_id);
  assert.ok(action.conversion.target_workspace_id);

  const actions = listIpGrowthActions(db, workspaceId);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].target_medium, 'youtube_short');
  db.close();
});

test('IP Growth Engine blocks an incomplete source', () => {
  const db = createDb();
  const workspaceId = Story.create(db, { title: 'Empty IP', genre: 'fantasy', pitch: 'Not finished.' });
  upsertCreativeProfile(db, workspaceId, {
    story_vision: 'An unfinished story.',
    story_kind: 'fantasy',
    emotional_effect: 'wonder',
    medium: 'book',
    audience: 'adult',
    goal: 'entertain'
  });

  const result = evaluateIpGrowth(db, workspaceId);
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.includes('validation_seed_not_passed'));
  assert.throws(() => startIpExpansion(db, workspaceId, 'movie'), /IP growth is blocked/i);
  db.close();
});
