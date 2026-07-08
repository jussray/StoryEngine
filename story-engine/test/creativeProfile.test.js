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

test('ELI5 and ELI10 resolve to different audience instructions', () => {
  const eli5 = resolveCreativeProfile({
    medium: 'book',
    audience: 'eli5',
    genre: 'science',
    tone: 'playful',
    goal: 'teach'
  });
  const eli10 = resolveCreativeProfile({
    medium: 'book',
    audience: 'eli10',
    genre: 'science',
    tone: 'adventurous',
    goal: 'teach'
  });

  assert.equal(eli5.resolved_rules.reading_level, 'grade-1');
  assert.equal(eli5.resolved_rules.vocabulary, 'simple');
  assert.equal(eli5.resolved_rules.max_sentence_words, 12);
  assert.equal(eli10.resolved_rules.reading_level, 'grades-4-6');
  assert.equal(eli10.resolved_rules.vocabulary, 'moderate');
  assert.equal(eli10.resolved_rules.max_sentence_words, 18);
  assert.notEqual(eli5.resolved_rules.profile_instruction, eli10.resolved_rules.profile_instruction);
});

test('picture-book profile resolves page and illustration rules', () => {
  const profile = resolveCreativeProfile({
    medium: 'picture_book',
    audience: 'child',
    genre: 'bedtime fantasy',
    tone: 'gentle',
    goal: 'entertain_and_teach',
    constraints: ['bedtime safe', 'optimistic ending']
  });

  assert.equal(profile.resolved_rules.unit, 'page');
  assert.equal(profile.resolved_rules.default_length, 32);
  assert.equal(profile.resolved_rules.illustration_cues, 'every_page');
  assert.equal(profile.resolved_rules.redteam_pre_runtime, true);
  assert.equal(profile.resolved_rules.redteam_pre_release, true);
  assert.equal(profile.resolved_rules.require_human_decision, true);
});

test('Creative Profile persists and increments version on update', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);

  const first = upsertCreativeProfile(db, workspaceId, {
    medium: 'book', audience: 'eli10', tone: 'adventurous', goal: 'entertain'
  });
  const second = upsertCreativeProfile(db, workspaceId, {
    medium: 'movie', audience: 'teen', tone: 'cinematic', goal: 'entertain'
  });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(second.medium, 'movie');
  assert.equal(getCreativeProfile(db, workspaceId).audience, 'teen');
  assert.equal(creativeProfileContext(db, workspaceId).instructions.structure, 'screenplay_three_act');
  db.close();
});

test('OODA decision carries Creative Profile strategy', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  upsertCreativeProfile(db, workspaceId, {
    medium: 'song',
    audience: 'eli10',
    genre: 'educational hip-hop',
    tone: 'playful',
    goal: 'teach',
    outputs: ['song', 'short_clip']
  });

  const decision = evaluateWorkspace(db, workspaceId);

  assert.equal(decision.strategy.medium, 'song');
  assert.equal(decision.strategy.audience, 'eli10');
  assert.equal(decision.strategy.eli_level, 'eli10');
  assert.equal(decision.strategy.redteam_pre_runtime, true);
  assert.equal(decision.strategy.redteam_pre_release, true);
  assert.deepEqual(decision.strategy.outputs, ['song', 'short_clip']);
  assert.equal(decision.reasons.some(item => item.code === 'missing_creative_profile'), false);
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
  assert.ok(gate.blockers.some(item => item.includes('Creative Profile')));
  db.close();
});

test('Release Gate exposes the profile after configuration', () => {
  const db = createDb();
  const workspaceId = seedWorkspace(db);
  upsertCreativeProfile(db, workspaceId, {
    medium: 'picture_book',
    audience: 'child',
    genre: 'bedtime fantasy',
    tone: 'gentle',
    goal: 'entertain_and_teach'
  });

  const gate = evaluateReleaseGate(db, workspaceId);

  assert.equal(gate.metrics.creative_profile_present, true);
  assert.equal(gate.creative_profile.medium, 'picture_book');
  assert.equal(gate.strategy.audience, 'child');
  assert.equal(gate.blockers.some(item => item.includes('Creative Profile')), false);
  db.close();
});
