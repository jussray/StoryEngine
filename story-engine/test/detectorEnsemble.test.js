import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreVoiceIntegrity, scoreHumanLikeness, compareVoiceIntegrity } from '../lib/detectorEnsemble.js';

const fingerprint = { audience: 'adult', medium: 'book', tone: 'intimate' };

const clusteredText = 'Furthermore, it is worth noting that this ever-evolving tapestry underscores the transformative journey. Moreover, this robust beacon showcases a seamless realm. In conclusion, the narrative leverages crucial insights.';
const concreteText = 'Mara left the cup on the windowsill. Rain ticked against the glass. She meant to call him back, but the phone stayed cold in her hand. Outside, the alley smelled like pennies and wet brick.';

test('voice audit treats clustered style signals as a quality signal, not authorship proof', () => {
  const clustered = scoreVoiceIntegrity(clusteredText, fingerprint);
  const concrete = scoreVoiceIntegrity(concreteText, fingerprint);
  assert.equal(clustered.authorship_inference, 'not_supported');
  assert.equal(concrete.authorship_inference, 'not_supported');
  assert.equal(clustered.signals.style_signal_clustered, true);
  assert.ok(clustered.signals.style_signal_hits > concrete.signals.style_signal_hits);
});

test('a single common marker does not become an authorship verdict or clustered failure', () => {
  const report = scoreVoiceIntegrity('Furthermore, Mara took the red cup outside and waited for the rain.', fingerprint);
  assert.equal(report.authorship_inference, 'not_supported');
  assert.equal(report.signals.style_signal_hits, 1);
  assert.equal(report.signals.style_signal_clustered, false);
});

test('legacy scoreHumanLikeness name is compatibility-only and carries the no-authorship boundary', () => {
  const current = scoreVoiceIntegrity(concreteText, fingerprint);
  const legacy = scoreHumanLikeness(concreteText, fingerprint);
  assert.deepEqual(legacy, current);
  assert.equal(legacy.audit_kind, 'voice-density-quality-control');
});

test('compareVoiceIntegrity reports quality delta without claiming who wrote the text', () => {
  const comparison = compareVoiceIntegrity(clusteredText, concreteText, fingerprint);
  assert.equal(comparison.authorship_inference, 'not_supported');
  assert.equal(typeof comparison.delta, 'number');
  assert.equal(typeof comparison.improved, 'boolean');
});
