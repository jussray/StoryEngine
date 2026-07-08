import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAudienceLens,
  resolveAudienceLens,
  evaluateAudienceFit,
  AUDIENCE_LENS_OPTIONS
} from '../lib/audienceLens.js';

test('ELI5 and ELI10 are audience lenses, not separate pipelines', () => {
  assert.deepEqual(AUDIENCE_LENS_OPTIONS.supported, ['eli5', 'eli10']);
  assert.equal(resolveAudienceLens('eli5').active, true);
  assert.equal(resolveAudienceLens('eli10').active, true);
  assert.equal(resolveAudienceLens('adult').active, false);
});

test('ELI5 uses shorter sentences and concrete explanation rules', () => {
  const lens = getAudienceLens('eli5');
  assert.equal(lens.max_sentence_words, 12);
  assert.equal(lens.vocabulary, 'simple_concrete');
  assert.match(resolveAudienceLens('eli5').instruction, /one idea at a time/i);
});

test('ELI10 preserves more detail while remaining clear', () => {
  const lens = getAudienceLens('eli10');
  assert.equal(lens.max_sentence_words, 18);
  assert.equal(lens.abstraction_policy, 'define_then_demonstrate');
  assert.match(resolveAudienceLens('eli10').instruction, /cause and effect/i);
});

test('audience fit identifies text that exceeds ELI5 sentence targets', () => {
  const result = evaluateAudienceFit(
    'The machine uses several interconnected systems that coordinate through a complicated sequence of signals and feedback loops before anything useful can happen.',
    'eli5'
  );
  assert.equal(result.active, true);
  assert.ok(result.score < 100);
  assert.ok(result.findings.some(finding => finding.code === 'audience_lens_sentence_length'));
});

test('empty ELI output is a critical audience-fit failure', () => {
  const result = evaluateAudienceFit('', 'eli10');
  assert.equal(result.passed, false);
  assert.ok(result.findings.some(finding => finding.severity === 'critical'));
});
