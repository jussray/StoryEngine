import test from 'node:test';
import assert from 'node:assert/strict';

import { runBlader } from '../lib/blader.js';

const fingerprint = { audience: 'young_adult', medium: 'book', tone: 'moody' };
const styledDraft = 'Furthermore, the protagonist embarks on a transformative journey through a seamless realm that showcases a robust tapestry of emotion. Moreover, it is worth noting that this beacon underscores the crucial nature of friendship and courage. In conclusion, the story leverages a powerful lesson.';

test('Blader preserves vocabulary instead of rewriting detector-associated words', () => {
  const result = runBlader(styledDraft, fingerprint, { force: true });
  assert.match(result.text, /Furthermore/i);
  assert.match(result.text, /transformative/i);
  assert.match(result.text, /tapestry/i);
  assert.match(result.text, /leverages/i);
  assert.equal(result.mutation_policy, 'mechanical-cleanup-only-force-does-not-enable-style-rewrite');
});

test('Blader reports voice-density quality without authorship inference', () => {
  const result = runBlader(styledDraft, fingerprint);
  assert.equal(result.authorship_inference, 'not_supported');
  assert.equal(result.detector_report.authorship_inference, 'not_supported');
  assert.equal(result.detector_report.audit_kind, 'voice-density-quality-control');
  assert.equal(result.detector_report.signals.style_signal_clustered, true);
  assert.ok(result.detector_report.signals.style_signal_hits >= 3);
});

test('Blader only applies mechanical cleanup and voice-density audit', () => {
  const result = runBlader('A precise line—kept intact.  Another line .', fingerprint, { force: true });
  assert.deepEqual(result.passes, ['mechanical_cleanup', 'voice_density_audit']);
  assert.equal(result.text, 'A precise line—kept intact. Another line.');
  assert.match(result.text, /—/);
  assert.equal(result.accepted, true);
});
