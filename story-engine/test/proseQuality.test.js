import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeProse,
  cleanProseMechanics,
  detectProsePatterns,
  evaluateProseQuality,
  PROSE_QUALITY_MODES
} from '../lib/proseQuality.js';

test('unphased prose stays observational rather than inventing a narrative phase', () => {
  const result = evaluateProseQuality('She set the keys on the kitchen table at 7:14 and checked her phone.');
  assert.equal(result.status, 'OBSERVE');
  assert.equal(result.phase, null);
  assert.equal(result.thresholds, null);
  assert.equal(result.authorship_inference, 'not_supported');
  assert.match(result.continuity_cookie, /^prose-quality:v2:/);
});

test('phase thresholds preserve the approved Lindymode and Redteam budgets', () => {
  assert.equal(PROSE_QUALITY_MODES.lindymode_default.retreat.max_aiish_score, 24);
  assert.equal(PROSE_QUALITY_MODES.lindymode_default.retreat.min_voice_grip, 68);
  assert.equal(PROSE_QUALITY_MODES.lindymode_default.retreat.require_contradiction, true);
  assert.equal(PROSE_QUALITY_MODES.redteam_strict.aftermath.max_pattern_score, 16);
});

test('grounded prose can pass a named setup phase', () => {
  const text = "Mara locked the kitchen door at 9:10, shoved the rent envelope under her coat, and checked her phone. She'd promised to leave, but the car was still idling at the corner.";
  const result = evaluateProseQuality(text, { phase: 'setup' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.analysis.has_concrete_detail, true);
  assert.equal(result.analysis.has_contradiction, true);
});

test('retreat phase requires contradiction under the approved quality contract', () => {
  const text = 'She put the key beside the kitchen sink at 8:00. The phone stayed face down on the table.';
  const result = evaluateProseQuality(text, { phase: 'retreat' });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.failures.includes('Missing contradiction signal'));
});

test('isolated vocabulary and punctuation do not create a style-density penalty', () => {
  const text = 'The tapestry hung beside the kitchen door—blue thread, loose at one corner.';
  const analysis = analyzeProse(text);
  assert.equal(analysis.synthetic_density_score, 0);
  assert.equal(analysis.authorship_inference, 'not_supported');
  assert.equal(analysis.style_density.clustered, false);
});

test('clustered synthetic style patterns can fail strict aftermath without claiming authorship', () => {
  const text = 'It is important to note that, at its core, this meaningful journey is not just love but also truth. Moreover, it is a tapestry of pain, emotion, loyalty, complexity, survival, and love. Furthermore, the robust narrative underscores a seamless shared journey.';
  const result = evaluateProseQuality(text, { phase: 'aftermath', mode: 'redteam_strict' });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.authorship_inference, 'not_supported');
  assert.equal(result.analysis.style_density.clustered, true);
  assert.ok(result.analysis.synthetic_density_score > result.thresholds.max_aiish_score);
  assert.match(result.note, /never establish authorship/i);
});

test('pattern detector scores density only after allowances are exceeded or patterns cluster', () => {
  const isolated = detectProsePatterns('Furthermore, the room was quiet.');
  const clustered = detectProsePatterns('Furthermore, moreover, additionally, the tapestry was robust and seamless.');
  assert.equal(isolated.total_pattern_score, 0);
  assert.equal(isolated.clustered, false);
  assert.equal(clustered.clustered, true);
  assert.ok(clustered.total_pattern_score > 0);
});

test('mechanical cleanup preserves valid words and em dashes', () => {
  const cleaned = cleanProseMechanics('Furthermore,  the crucial detail—her red umbrella—mattered .');
  assert.equal(cleaned, 'Furthermore, the crucial detail—her red umbrella—mattered.');
});

test('analysis emits a stable density fingerprint for unchanged subject and policy', () => {
  const text = "She checked the phone at 11:03, but didn't answer.";
  const first = evaluateProseQuality(text, { phase: 'retreat', mode: 'redteam_strict' });
  const second = evaluateProseQuality(text, { phase: 'retreat', mode: 'redteam_strict' });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.continuity_cookie, second.continuity_cookie);
  assert.deepEqual(analyzeProse(text), first.analysis);
});
