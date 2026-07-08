import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { upsertCreativeProfile, creativeProfileContext } from '../lib/creativeProfile.js';
import {
  BLUEPRINT_TARGETS,
  buildStoryBlueprint,
  convertBlueprint,
  listBlueprintConversions,
  getBlueprintContinuationOptions
} from '../lib/storyBlueprint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function createValidatedBook(db) {
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

test('Blueprint targets include short clips, YouTube Shorts, movies, and IP decks', () => {
  assert.ok(BLUEPRINT_TARGETS.includes('short_clip'));
  assert.ok(BLUEPRINT_TARGETS.includes('youtube_short'));
  assert.ok(BLUEPRINT_TARGETS.includes('movie'));
  assert.ok(BLUEPRINT_TARGETS.includes('ip_deck'));
});

test('a children book becomes a seed-gated story blueprint', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const blueprint = buildStoryBlueprint(db, workspaceId);
  assert.equal(blueprint.source_workspace_id, workspaceId);
  assert.equal(blueprint.validation.passed, true);
  assert.deepEqual(blueprint.blueprint.seed_gate.required_order, [
    'book', 'lindymode_validation', 'ooda_decision', 'redteam_seed_check', 'conversion_ready'
  ]);
  assert.equal(blueprint.blueprint.seed_gate.lindymode_validation.passed, true);
  assert.equal(blueprint.blueprint.seed_gate.ooda_decision.passed, true);
  assert.equal(blueprint.blueprint.seed_gate.redteam_seed_check.passed, true);
  assert.equal(blueprint.blueprint.seed_gate.conversion_ready, true);
  assert.equal(blueprint.blueprint.developmental_profile.age_band, 'about 5');
  assert.equal(blueprint.blueprint.proof.validated_seed_source, true);
  assert.equal(blueprint.blueprint.beats.length, 2);
  db.close();
});

test('continuation options unlock only after seed gate passes', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const options = getBlueprintContinuationOptions(db, workspaceId);
  assert.equal(options.seed_gate.conversion_ready, true);
  assert.ok(options.options.length > 0);
  assert.equal(options.options[0].target_medium, 'youtube_short');
  assert.match(options.options[0].continuation_type, /child-safe/);
  db.close();
});

test('a seed-gated book blueprint converts into a YouTube Short workspace', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const conversion = convertBlueprint(db, workspaceId, 'youtube_short');
  assert.equal(conversion.source_workspace_id, workspaceId);
  assert.equal(conversion.target_medium, 'youtube_short');
  assert.equal(conversion.validation.passed, true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'lindymode_seed_validated' && check.passed), true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'ooda_seed_cleared' && check.passed), true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'redteam_seed_checked' && check.passed), true);
  assert.ok(conversion.target_workspace_id);
  assert.match(conversion.conversion.structure[0], /hook/i);

  const targetProfile = creativeProfileContext(db, conversion.target_workspace_id);
  assert.equal(targetProfile.audience, 'eli5');
  assert.ok(targetProfile.constraints.some(item => item.includes('source_blueprint')));
  assert.ok(targetProfile.constraints.some(item => item.includes('Redteam seed check')));
  assert.equal(listBlueprintConversions(db, conversion.blueprint_id).length, 1);
  db.close();
});

test('conversion blocks when Lindymode seed validation fails', () => {
  const db = createDb();
  const workspaceId = Story.create(db, {
    title: 'Empty Seed',
    genre: 'educational',
    pitch: 'A book that is not ready.'
  });
  upsertCreativeProfile(db, workspaceId, {
    story_vision: 'A book that is not ready.',
    story_kind: 'educational',
    emotional_effect: 'wonder',
    medium: 'picture_book',
    audience: 'eli5',
    goal: 'entertain_and_teach'
  });
  const blueprint = buildStoryBlueprint(db, workspaceId);
  assert.equal(blueprint.blueprint.seed_gate.conversion_ready, false);
  assert.equal(blueprint.blueprint.seed_gate.status, 'blocked_lindymode');
  assert.throws(() => convertBlueprint(db, workspaceId, 'youtube_short'), /Seed is not conversion-ready/i);
  db.close();
});

test('movie conversion preserves canon promises from the source book', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const conversion = convertBlueprint(db, workspaceId, 'movie');
  assert.equal(conversion.conversion.validation_promises.includes('preserve canon and character identity'), true);
  assert.equal(conversion.conversion.validation_promises.includes('adapt pacing to target medium'), true);
  db.close();
});
