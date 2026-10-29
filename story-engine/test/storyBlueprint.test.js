import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as Story from '../models/storyModel.js';
import * as Chapter from '../models/chapterModel.js';
import { upsertCreativeProfile, creativeProfileContext } from '../lib/creativeProfile.js';
import { buildStoryGenome, getStoryGenome } from '../lib/storyGenome.js';
import {
  BLUEPRINT_TARGETS,
  buildStoryBlueprint,
  convertBlueprint,
  listBlueprintConversions,
  getBlueprintContinuationOptions
} from '../lib/storyBlueprint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
const TEST_IDENTITY = Object.freeze({ tenant_id: 'tenant-test', actor_id: 'actor-test', role: 'creator' });

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function createValidatedBook(db) {
  const workspaceId = Story.create(db, {
    title: 'The Little Cloud Garden',
    genre: 'educational',
    pitch: 'A shy cloud learns rain helps flowers grow.',
    ...TEST_IDENTITY
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

test('a seed-gated book blueprint converts into a YouTube Short workspace with source ownership', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const conversion = convertBlueprint(db, workspaceId, 'youtube_short');
  assert.equal(conversion.source_workspace_id, workspaceId);
  assert.equal(conversion.target_medium, 'youtube_short');
  assert.equal(conversion.validation.passed, true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'lindymode_seed_validated' && check.passed), true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'ooda_seed_cleared' && check.passed), true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'redteam_seed_checked' && check.passed), true);
  assert.equal(conversion.validation.checks.some(check => check.check === 'source_ownership_preserved' && check.passed), true);
  assert.ok(conversion.target_workspace_id);
  assert.match(conversion.conversion.structure[0], /hook/i);
  assert.equal(conversion.conversion.source_genome.workspace_id, workspaceId);
  assert.ok(conversion.conversion.source_genome.version >= 1);
  assert.match(conversion.conversion.source_genome.genome_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    conversion.validation.checks.some(check => check.check === 'source_genome_bound' && check.passed),
    true
  );

  const sourceGenomeAtConversion = { ...conversion.conversion.source_genome };
  Chapter.create(db, workspaceId, {
    title: 'After the Conversion',
    content: 'Cloud learns another lesson after the adaptation already exists.',
    position: 2
  });
  const evolvedGenome = buildStoryGenome(db, workspaceId);
  assert.ok(evolvedGenome.version > sourceGenomeAtConversion.version);
  assert.notEqual(evolvedGenome.genome_hash, sourceGenomeAtConversion.genome_hash);

  const storedConversion = listBlueprintConversions(db, conversion.blueprint_id)[0];
  assert.deepEqual(storedConversion.conversion.source_genome, sourceGenomeAtConversion);
  assert.equal(getStoryGenome(db, workspaceId).version, evolvedGenome.version);

  const derived = Story.get(db, conversion.target_workspace_id);
  assert.equal(derived.tenant_id, TEST_IDENTITY.tenant_id);
  assert.equal(derived.created_by_actor_id, TEST_IDENTITY.actor_id);

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
    pitch: 'A book that is not ready.',
    ...TEST_IDENTITY
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


test('legacy blueprint without source_genome resolves against the exact current immutable Genome', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const blueprint = buildStoryBlueprint(db, workspaceId);
  const stored = db.prepare('SELECT blueprint_json FROM story_blueprints WHERE blueprint_id=?')
    .get(blueprint.blueprint_id);
  const legacyBlueprint = JSON.parse(stored.blueprint_json);
  delete legacyBlueprint.source_genome;
  delete legacyBlueprint.canon.genome_hash;
  db.prepare('UPDATE story_blueprints SET blueprint_json=? WHERE blueprint_id=?')
    .run(JSON.stringify(legacyBlueprint), blueprint.blueprint_id);

  const conversion = convertBlueprint(db, workspaceId, 'youtube_short');

  assert.equal(conversion.conversion.source_genome.workspace_id, workspaceId);
  assert.equal(conversion.conversion.source_genome.version, legacyBlueprint.canon.version);
  assert.match(conversion.conversion.source_genome.genome_hash, /^sha256:[0-9a-f]{64}$/);

  db.close();
});

test('conversion fails before creating a target workspace when a legacy blueprint points to an unprovable Genome version', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const blueprint = buildStoryBlueprint(db, workspaceId);
  const stored = db.prepare('SELECT blueprint_json FROM story_blueprints WHERE blueprint_id=?')
    .get(blueprint.blueprint_id);
  const legacyBlueprint = JSON.parse(stored.blueprint_json);
  delete legacyBlueprint.source_genome;
  legacyBlueprint.canon.version = 999;
  delete legacyBlueprint.canon.genome_hash;
  db.prepare('UPDATE story_blueprints SET blueprint_json=? WHERE blueprint_id=?')
    .run(JSON.stringify(legacyBlueprint), blueprint.blueprint_id);

  const storyCountBefore = db.prepare('SELECT COUNT(*) AS count FROM stories').get().count;

  assert.throws(
    () => convertBlueprint(db, workspaceId, 'youtube_short'),
    /no immutable historical snapshot/
  );

  const storyCountAfter = db.prepare('SELECT COUNT(*) AS count FROM stories').get().count;
  assert.equal(storyCountAfter, storyCountBefore);
  assert.equal(listBlueprintConversions(db, blueprint.blueprint_id).length, 0);

  db.close();
});


test('conversion rejects a Blueprint whose source Genome declares another workspace', () => {
  const db = createDb();
  const workspaceId = createValidatedBook(db);
  const blueprint = buildStoryBlueprint(db, workspaceId);
  const stored = db.prepare('SELECT blueprint_json FROM story_blueprints WHERE blueprint_id=?')
    .get(blueprint.blueprint_id);
  const corrupted = JSON.parse(stored.blueprint_json);
  corrupted.source_genome.workspace_id = 'foreign-workspace';
  db.prepare('UPDATE story_blueprints SET blueprint_json=? WHERE blueprint_id=?')
    .run(JSON.stringify(corrupted), blueprint.blueprint_id);

  const storyCountBefore = db.prepare('SELECT COUNT(*) AS count FROM stories').get().count;

  assert.throws(
    () => convertBlueprint(db, workspaceId, 'youtube_short'),
    /workspace does not match the source workspace/
  );

  const storyCountAfter = db.prepare('SELECT COUNT(*) AS count FROM stories').get().count;
  assert.equal(storyCountAfter, storyCountBefore);
  assert.equal(listBlueprintConversions(db, blueprint.blueprint_id).length, 0);

  db.close();
});
