import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveCreativeProfile,
  upsertCreativeProfile,
  getCreativeProfile,
  creativeProfileContext
} from '../lib/creativeProfile.js';
import { evaluateWorkspace } from '../lib/decisionEngine.js';
import { evaluateReleaseGate } from '../lib/releaseGate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function seedWorkspace(db, workspaceId = 'workspace-profile') {
  const now = Date.now();
  db.prepare(`
    INSERT INTO stories (workspace_id, title, genre, pitch, schema_version, created_at, updated_at)
    VALUES (?, 'Profile Story', 'fantasy', 'A dragon protects a hidden village.', '1.0.0', ?, ?)
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
    ) VALUES ('run-profile', 'corr-profile', ?, 'test', 'completed', '[]', '{}', ?, ?)
  `).run(workspaceId, now, now);
  return workspaceId;
}

function baseProfile(overrides = {}) {
  return {
    story_vision: 'A lonely dragon discovers the village he feared can become his family.',
    story_kind: 'fantasy',
    emotional_effect: 'wonder',
    medium: 'book',
    audience: 'eli10',
    genre: 'fantasy',
    tone: 'adventurous',
    goal: 'entertain',
    ...overrides
  };
}

test('story vision and story kind are required before profile resolution', () => {
  assert.throws(() => resolveCreativeProfile({ medium: 'book', audience: 'eli10', goal: 'teach' }), /what story/i);
  assert.throws(() => resolveCreativeProfile({ story_vision: 'A child learns courage.', medium: 'book', audience: 'eli10', goal: 'teach' }), /story kind/i);
});

test('ELI5 and ELI10 resolve to different audience instructions', () => {
  const eli5 = resolveCreativeProfile(baseProfile({
    audience: 'eli5',
    genre: 'science',
    story_kind: 'educational',
    tone: 'playful',
    goal: 'teach'
  }));
  const eli10 = resolveCreativeProfile(baseProfile({
    audience: 'eli10',
    genre: 'science',
    story_kind: 'educational',
    tone: 'adventurous',
    goal: 'teach'
  }));

  assert.equal(eli5.resolved_rules.reading_level, 'grade-1');
  assert.equal(eli5.resolved_rules.vocabulary, 'simple');
  assert.equal(eli5.resolved_rules.max_sentence_words, 12);
  assert.equal(eli10.resolved_rules.reading_level, 'grades-4-6');
  assert.equal(eli10.resolved_rules.vocabulary, 'moderate');
  assert.equal(eli10.resolved_rules.max_sentence_words, 18);
  assert.notEqual(eli5.resolved_rules.profile_instruction, eli10.resolved_rules.profile_instruction);
});

test('picture-book profile carries story intent and dual Redteam rules', () => {
  const profile = resolveCreativeProfile(baseProfile({
    medium: 'picture_book',
    audience: 'child',
    genre: 'bedtime fantasy',
    story_kind: 'fantasy',
    emotional_effect: 'comfort',
    tone: 'gentle',
    goal: 'entertain_and_teach',
    constraints: ['bedtime safe', 'optimistic ending']
  }));

  assert.equal(profile.resolved_rules.story_vision, profile.story_vision);
  assert.equal(profile.resolved_rules.story_kind, 'fantasy');
  assert.equal(profile.resolved_rules.emotional_effect, 'comfort');
  assert.equal(profile.resolved_rules.unit, 'page');
  assert.equal(profile.resolved_rules.default_length, 32);
  assert.equal(profile.resolved_rules.illustration_cues, 'every_page');
  assert.equal(profile.resolved_rules.redteam_pre_runtime, true);
  assert.equal(profile.resolved_rules.redteam_pre_release, true);
  assert.equal(profile.resolved_rules.require_human_decision, true);
});

test('Creative Profile persists story intent and increments version on update', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const first = upsertCreativeProfile(db, workspaceId, baseProfile());
  const second = upsertCreativeProfile(db, workspaceId, baseProfile({
    story_vision: 'The dragon must save the family that once feared him.',
    story_kind: 'adventure',
    emotional_effect: 'excitement',
    medium: 'movie',
    audience: 'teen',
    tone: 'cinematic'
  }));

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(second.story_kind, 'adventure');
  assert.equal(second.medium, 'movie');
  assert.equal(getCreativeProfile(db, workspaceId).audience, 'teen');
  assert.equal(creativeProfileContext(db, workspaceId).instructions.structure, 'screenplay_three_act');
  db.close();
});

test('OODA decision carries story vision before execution strategy', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  upsertCreativeProfile(db, workspaceId, baseProfile({
    story_vision: 'A beat teaches children how rain becomes rivers.',
    story_kind: 'educational',
    emotional_effect: 'wonder',
    medium: 'song',
    audience: 'eli10',
    genre: 'educational hip-hop',
    tone: 'playful',
    goal: 'teach',
    outputs: ['song', 'short_clip']
  }));

  const decision = evaluateWorkspace(db, workspaceId);

  assert.equal(decision.strategy.story_vision, 'A beat teaches children how rain becomes rivers.');
  assert.equal(decision.strategy.story_kind, 'educational');
  assert.equal(decision.strategy.emotional_effect, 'wonder');
  assert.equal(decision.strategy.medium, 'song');
  assert.equal(decision.strategy.audience, 'eli10');
  assert.equal(decision.strategy.eli_level, 'eli10');
  assert.equal(decision.strategy.redteam_pre_runtime, true);
  assert.equal(decision.strategy.redteam_pre_release, true);
  assert.deepEqual(decision.strategy.outputs, ['song', 'short_clip']);
  assert.equal(decision.evidence.creative_profile_complete, true);
  db.close();
});

test('OODA penalizes and Release Gate blocks a missing Creative Profile', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const decision = evaluateWorkspace(db, workspaceId);
  const gate = evaluateReleaseGate(db, workspaceId);

  assert.ok(decision.reasons.some(item => item.code === 'missing_creative_profile'));
  assert.equal(decision.strategy, null);
  assert.equal(gate.status, 'BLOCKED');
  assert.equal(gate.metrics.creative_profile_present, false);
  assert.equal(gate.metrics.creative_profile_complete, false);
  assert.ok(gate.blockers.some(item => item.includes('Creative Profile')));
  db.close();
});

test('Release Gate exposes complete story intent after configuration', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  upsertCreativeProfile(db, workspaceId, baseProfile({
    medium: 'picture_book',
    audience: 'child',
    genre: 'bedtime fantasy',
    story_kind: 'fantasy',
    emotional_effect: 'comfort',
    tone: 'gentle',
    goal: 'entertain_and_teach'
  }));

  const gate = evaluateReleaseGate(db, workspaceId);

  assert.equal(gate.metrics.creative_profile_present, true);
  assert.equal(gate.metrics.creative_profile_complete, true);
  assert.equal(gate.creative_profile.medium, 'picture_book');
  assert.equal(gate.strategy.story_kind, 'fantasy');
  assert.equal(gate.strategy.audience, 'child');
  assert.equal(gate.blockers.some(item => item.includes('Story vision')), false);
  db.close();
});
