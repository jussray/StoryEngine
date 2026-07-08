import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getChildrenBookProfile,
  childrenBookInstruction
} from '../lib/childrenBookProfile.js';
import { resolveCreativeProfile } from '../lib/creativeProfile.js';

test('ELI5 picture books get a full production profile', () => {
  const profile = getChildrenBookProfile('eli5', 'picture_book');
  assert.equal(profile.active, true);
  assert.equal(profile.age_band, 'about 5');
  assert.equal(profile.page_count, 32);
  assert.match(profile.plot_complexity, /one main goal/i);
  assert.equal(profile.process_requirements.ghost.includes('plan illustration beats'), true);
  assert.equal(profile.process_requirements.artifacts.includes('parent or educator guide'), true);
});

test('ELI10 books use chapter-scale developmental planning', () => {
  const profile = getChildrenBookProfile('eli10', 'book');
  assert.equal(profile.developmental_stage, 'independent developing reader');
  assert.deepEqual(profile.target_word_count, [4000, 18000]);
  assert.match(profile.page_turn_strategy, /chapter hooks/i);
  assert.match(childrenBookInstruction(profile), /cause, effect, and reflection/i);
});

test('adult books do not receive a children book production profile', () => {
  assert.equal(getChildrenBookProfile('adult', 'book'), null);
});

test('Creative Profile carries child-development rules through the whole pipeline', () => {
  const profile = resolveCreativeProfile({
    story_vision: 'A shy cloud learns how rain helps a garden grow.',
    story_kind: 'educational',
    emotional_effect: 'wonder',
    medium: 'picture_book',
    audience: 'eli5',
    goal: 'entertain_and_teach'
  });
  const child = profile.resolved_rules.children_book_profile;
  assert.ok(child);
  assert.equal(child.process_requirements.runtime.includes('emit illustration cues'), true);
  assert.equal(child.process_requirements.redteam_pre_release.includes('check educational accuracy'), true);
  assert.match(profile.resolved_rules.profile_instruction, /Target 350-1000 words/i);
});
