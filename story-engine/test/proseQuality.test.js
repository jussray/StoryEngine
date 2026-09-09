import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeProse,
  evaluateProseQuality,
  PROSE_QUALITY_MODES
} from '../lib/proseQuality.js';

test('unphased prose stays observational rather than inventing a narrative phase', () => {
  const result = evaluateProseQuality('She set the keys on the kitchen table at 7:14 and checked her phone.');
  assert.equal(result.status, 'OBSERVE');
  assert.equal(result.phase, null);
  assert.equal(result.thresholds, null);
  assert.match(result.continuity_cookie, /^prose-quality:v1:/);
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

test('dense synthetic markers fail strict aftermath without claiming authorship', () => {
  const text = 'It is important to note that, at its core, this meaningful journey is not just love but also truth. Moreover, it is a tapestry of pain, emotion, loyalty, complexity, survival, and love.';
  const result = evaluateProseQuality(text, { phase: 'aftermath', mode: 'redteam_strict' });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.analysis.aiish_score > result.thresholds.max_aiish_score);
  assert.match(result.note, /not treated as proof of AI authorship/i);
});

test('analysis emits a stable density fingerprint for unchanged subject and policy', () => {
  const text = "She checked the phone at 11:03, but didn't answer.";
  const first = evaluateProseQuality(text, { phase: 'retreat', mode: 'redteam_strict' });
  const second = evaluateProseQuality(text, { phase: 'retreat', mode: 'redteam_strict' });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.continuity_cookie, second.continuity_cookie);
  assert.deepEqual(analyzeProse(text), first.analysis);
});
