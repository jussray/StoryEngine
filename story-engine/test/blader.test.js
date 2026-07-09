import test from 'node:test';
import assert from 'node:assert/strict';

import { runBlader } from '../lib/blader.js';
import { scoreHumanLikeness } from '../lib/detectorEnsemble.js';

const fingerprint = { audience: 'young_adult', medium: 'book', tone: 'moody' };
const aiDraft = 'Furthermore, the protagonist embarks on a transformative journey through a seamless realm that showcases a robust tapestry of emotion. Moreover, it is worth noting that this beacon underscores the crucial nature of friendship and courage. In conclusion, the story leverages a powerful lesson.';

test('Blader strips common AI signals through Ghost base pass', () => {
  const result = runBlader(aiDraft, fingerprint, { force: true });
  assert.doesNotMatch(result.text, /Furthermore/i);
  assert.doesNotMatch(result.text, /In conclusion/i);
  assert.doesNotMatch(result.text, /tapestry/i);
  assert.doesNotMatch(result.text, /leverages/i);
});

test('Blader improves detector score on AI-ish draft', () => {
  const before = scoreHumanLikeness(aiDraft, fingerprint);
  const result = runBlader(aiDraft, fingerprint, { force: true });
  assert.ok(result.blader_score >= before.score, `expected ${result.blader_score} >= ${before.score}`);
  assert.ok(result.comparison.delta >= 0);
});

test('Blader reports pass list and detector report without fixed phrase injection', () => {
  const result = runBlader(aiDraft, fingerprint, { force: true });
  assert.ok(result.passes.includes('sentence_fragmentation'));
  assert.ok(!result.passes.includes('rhythm_injection'));
  assert.doesNotMatch(result.text, /Not loudly\./);
  assert.doesNotMatch(result.text, /That part mattered\./);
  assert.doesNotMatch(result.text, /just for a breath/);
  assert.equal(typeof result.detector_report.score, 'number');
});
