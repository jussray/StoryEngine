import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreHumanLikeness, compareHumanScores } from '../lib/detectorEnsemble.js';

const fingerprint = { audience: 'adult', medium: 'book', tone: 'intimate' };

const aiText = 'Furthermore, it is worth noting that this ever-evolving tapestry underscores the transformative journey. Moreover, this robust beacon showcases a seamless realm. In conclusion, the narrative leverages crucial insights.';
const humanText = 'Mara left the cup on the windowsill. Rain ticked against the glass. She meant to call him back, but the phone stayed cold in her hand. Outside, the alley smelled like pennies and wet brick.';

test('known AI-ish text scores lower than concrete human-ish prose', () => {
  const ai = scoreHumanLikeness(aiText, fingerprint);
  const human = scoreHumanLikeness(humanText, fingerprint);
  assert.ok(ai.score < human.score, `expected AI score ${ai.score} to be lower than human score ${human.score}`);
  assert.ok(ai.signals.ai_signal_hits > human.signals.ai_signal_hits);
});

test('detector report includes per-signal breakdown', () => {
  const report = scoreHumanLikeness(humanText, fingerprint);
  assert.equal(typeof report.score, 'number');
  assert.equal(typeof report.threshold, 'number');
  assert.equal(typeof report.signals.burstiness_score, 'number');
  assert.equal(typeof report.signals.perplexity_proxy_score, 'number');
  assert.equal(typeof report.signals.fingerprint_match_score, 'number');
});

test('compareHumanScores reports delta and improvement flag', () => {
  const comparison = compareHumanScores(aiText, humanText, fingerprint);
  assert.ok(comparison.delta > 0);
  assert.equal(comparison.improved, true);
});
