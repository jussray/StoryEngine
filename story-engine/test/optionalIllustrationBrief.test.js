import test from 'node:test';
import assert from 'node:assert/strict';
import { illustrationBrief } from '../lib/artifactValidation.js';

const chapters = [{ title: 'Introduction', content: 'A concise overview of the topic.' }];

test('ordinary books do not require chapter visuals', () => {
  assert.deepEqual(illustrationBrief(chapters, null), []);
});

test('ordinary books can opt in to chapter visuals', () => {
  const cues = illustrationBrief(chapters, null, { includeVisuals: true });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].title, 'Introduction');
  assert.match(cues[0].cue, /Optional visual/);
});

test('children book profiles preserve their existing illustration cues', () => {
  const profile = { resolved_rules: { children_book_profile: {
    illustration_density: 'high', page_turn_strategy: 'gentle'
  } } };
  assert.match(illustrationBrief(chapters, profile)[0].cue, /high coverage and gentle pacing/);
});
