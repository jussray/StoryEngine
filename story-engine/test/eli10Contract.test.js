import test from 'node:test';
import assert from 'node:assert/strict';
import { ELI10_CONTRACT, eli10VoiceInstruction } from '../lib/eli10Contract.js';
import { evaluateAudienceFit, resolveAudienceLens } from '../lib/audienceLens.js';

test('Eli10 contract has required creative fields', () => {
  assert.ok(ELI10_CONTRACT.voice.sentence_target_words > 0);
  assert.ok(ELI10_CONTRACT.voice.sentence_hard_cap_words > ELI10_CONTRACT.voice.sentence_target_words);
  assert.ok(Array.isArray(ELI10_CONTRACT.scaffolding));
  assert.ok(Array.isArray(ELI10_CONTRACT.emotional.allowed_range));
  assert.ok(ELI10_CONTRACT.emotional.stakes_model.length > 0);
  assert.ok(ELI10_CONTRACT.redteam.condescending_tone_signals.length > 0);
});

test('eli10VoiceInstruction returns a non-empty string', () => {
  const inst = eli10VoiceInstruction();
  assert.ok(typeof inst === 'string' && inst.length > 50);
});

test('resolveAudienceLens eli10 includes voice_instruction', () => {
  const lens = resolveAudienceLens('eli10');
  assert.ok(lens.active);
  assert.ok(lens.instruction && lens.instruction.length > 20);
  assert.ok(lens.stakes_model);
  assert.ok(lens.darkness_policy);
});

test('evaluateAudienceFit passes clean Eli10 prose', () => {
  const text = 'Maya ran down the hall. Her sneakers squeaked. She had to find the key before the bell rang. The locker felt cold under her fingers. Just three more combinations and she\'d know the truth.';
  const result = evaluateAudienceFit(text, 'eli10');
  assert.ok(result.passed);
  assert.ok(result.score >= 85);
  assert.strictEqual(result.findings.filter(f => f.severity === 'critical').length, 0);
});

test('evaluateAudienceFit flags condescending tone in Eli10', () => {
  const text = 'Remember, kids, that means the volcano is hot. Simply put, lava burns things.';
  const result = evaluateAudienceFit(text, 'eli10');
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.some(c => c === 'eli10_condescending_tone'));
});

test('evaluateAudienceFit flags baby talk in Eli10', () => {
  const text = 'The widdle dragon was so scared of the dark.';
  const result = evaluateAudienceFit(text, 'eli10');
  assert.ok(!result.passed);
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.includes('eli10_baby_talk'));
});

test('evaluateAudienceFit flags long sentences in Eli10', () => {
  const longText = Array(5).fill(
    'The enormous, ancient, moss-covered stone archway stood at the very edge of the forgotten forest where the children had always been told never to go under any circumstances whatsoever.'
  ).join(' ');
  const result = evaluateAudienceFit(longText, 'eli10');
  const codes = result.findings.map(f => f.code);
  assert.ok(codes.some(c => c.includes('sentence')));
});
