// lib/blader.js

import { cleanProseMechanics } from './proseQuality.js';
import { compareVoiceIntegrity, scoreVoiceIntegrity } from './detectorEnsemble.js';

export function runBlader(text = '', fingerprint = {}, options = {}) {
  const original = String(text || '').trim();
  const cleaned = cleanProseMechanics(original);
  const comparison = compareVoiceIntegrity(original, cleaned, fingerprint);
  const finalReport = scoreVoiceIntegrity(cleaned, fingerprint);

  return {
    text: cleaned,
    blader_score: finalReport.score,
    detector_report: finalReport,
    comparison,
    passes: ['mechanical_cleanup', 'voice_density_audit'],
    accepted: true,
    threshold: finalReport.threshold,
    passed: finalReport.passed,
    authorship_inference: 'not_supported',
    mutation_policy: options.force
      ? 'mechanical-cleanup-only-force-does-not-enable-style-rewrite'
      : 'mechanical-cleanup-only'
  };
}
