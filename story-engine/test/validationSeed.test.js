import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VALIDATION_SEED_TYPES,
  getValidationSeedProfile,
  seedProofChecklist
} from '../lib/validationSeed.js';

test('validation seed assets cover non-children mediums', () => {
  assert.ok(VALIDATION_SEED_TYPES.book);
  assert.ok(VALIDATION_SEED_TYPES.movie);
  assert.ok(VALIDATION_SEED_TYPES.song);
  assert.ok(VALIDATION_SEED_TYPES.game);
  assert.ok(VALIDATION_SEED_TYPES.podcast);
});

test('a movie seed proves visual and adaptation value', () => {
  const seed = getValidationSeedProfile('movie');
  assert.equal(seed.label, 'Movie Seed');
  assert.ok(seed.proves.includes('visual premise'));
  assert.ok(seed.converts_to.includes('trailer'));
  assert.equal(seed.validation_contract.preserve_canon, true);
});

test('a song seed can convert into music video and short clip assets', () => {
  const seed = getValidationSeedProfile('song');
  assert.equal(seed.label, 'Song Seed');
  assert.ok(seed.proves.includes('hook'));
  assert.ok(seed.converts_to.includes('music_video'));
  assert.ok(seed.converts_to.includes('short_clip'));
});

test('children book seeds extend the base medium with child-development proof', () => {
  const seed = getValidationSeedProfile('picture_book', { age_band: 'about 5' });
  assert.equal(seed.label, 'Children’s Book Seed');
  assert.ok(seed.proves.includes('developmental fit'));
  assert.ok(seed.converts_to.includes('parent_guide'));
});

test('seed proof checklist is generated from the seed profile', () => {
  const seed = getValidationSeedProfile('game');
  const checklist = seedProofChecklist(seed);
  assert.ok(checklist.some(item => item.check === 'source_has_complete_units'));
  assert.ok(checklist.some(item => item.check === 'proves_player_goal'));
});
