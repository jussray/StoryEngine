// lib/detectorEnsemble.js
// Backward-compatible voice-quality scoring. Despite the historical filename and
// exported aliases, this module does not infer whether a human or model authored text.

import { analyzeProse } from './proseQuality.js';

function words(text = '') {
  return String(text || '').toLowerCase().match(/[a-z0-9’'-]+/gi) || [];
}

function sentences(text = '') {
  return String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(item => item.trim()).filter(Boolean) || [];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return average(values.map(value => (value - mean) ** 2));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function uniqueRatio(tokens) {
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

function fingerprintMatchScore(text, fingerprint = {}) {
  const lower = String(text || '').toLowerCase();
  const tokenList = words(text);
  const sentenceList = sentences(text);
  let score = 50;
  const audience = String(fingerprint.audience || '').toLowerCase();
  const medium = String(fingerprint.medium || '').toLowerCase();
  const tone = String(fingerprint.tone || '').toLowerCase();
  const avgSentence = sentenceList.length ? average(sentenceList.map(sentence => words(sentence).length)) : 0;

  if (audience === 'eli5' || audience === 'child' || audience === 'baby') {
    if (avgSentence <= 13) score += 18;
    else score -= 18;
  } else if (audience === 'eli10' || audience === 'middle_grade') {
    if (avgSentence <= 19) score += 12;
    else score -= 12;
  } else if (avgSentence >= 7 && avgSentence <= 28) {
    score += 8;
  }

  if (medium.includes('movie') || medium.includes('tv')) {
    if (/\b(int\.|ext\.|cut to|close on|scene)\b/i.test(text)) score += 12;
    else score -= 6;
  }
  if (medium.includes('picture') || medium.includes('book')) {
    if (sentenceList.length >= 2) score += 8;
  }
  if (tone && lower.includes(tone)) score += 4;
  if (uniqueRatio(tokenList) > 0.45) score += 8;

  return clamp(score);
}

export function scoreVoiceIntegrity(text = '', fingerprint = {}) {
  const raw = String(text || '').trim();
  const tokenList = words(raw);
  const sentenceList = sentences(raw);
  const sentenceLengths = sentenceList.map(sentence => words(sentence).length).filter(Boolean);
  const sentenceVariance = variance(sentenceLengths);
  const burstiness = Math.sqrt(sentenceVariance);
  const avgSentence = average(sentenceLengths);
  const unique = uniqueRatio(tokenList);
  const quality = analyzeProse(raw);
  const fingerprintScore = fingerprintMatchScore(raw, fingerprint);
  const repetitionPenalty = tokenList.length ? Math.max(0, 1 - unique) : 1;
  const repetitionScore = clamp(100 - repetitionPenalty * 35);
  const cadenceScore = clamp(70 + Math.min(20, burstiness * 2));
  const baseScore = clamp(
    fingerprintScore * 0.45 +
    repetitionScore * 0.25 +
    cadenceScore * 0.15 +
    Math.min(100, unique * 110) * 0.15
  );
  const composite = clamp(baseScore - Math.min(24, quality.synthetic_density_score * 0.4));
  const threshold = Number(process.env.BLADER_VOICE_SCORE_THRESHOLD || process.env.BLADER_HUMAN_SCORE_THRESHOLD || 72);

  return {
    score: composite,
    threshold,
    passed: composite >= threshold,
    authorship_inference: 'not_supported',
    audit_kind: 'voice-density-quality-control',
    signals: {
      word_count: tokenList.length,
      sentence_count: sentenceList.length,
      avg_sentence_length: Number(avgSentence.toFixed(2)),
      sentence_length_variance: Number(sentenceVariance.toFixed(2)),
      burstiness: Number(burstiness.toFixed(2)),
      unique_word_ratio: Number(unique.toFixed(3)),
      style_signal_hits: quality.style_density.raw_hits,
      style_signal_density: tokenList.length ? Number((quality.style_density.raw_hits / Math.max(1, tokenList.length / 100)).toFixed(3)) : 0,
      style_signal_clustered: quality.style_density.clustered,
      style_signal_families: quality.pattern_hits,
      fingerprint_match_score: fingerprintScore,
      repetition_score: repetitionScore,
      cadence_score: cadenceScore,
      synthetic_density_score: quality.synthetic_density_score
    }
  };
}

// Historical export retained so existing integrations do not break. Its semantics are
// now exactly scoreVoiceIntegrity and it carries an explicit no-authorship boundary.
export function scoreHumanLikeness(text = '', fingerprint = {}) {
  return scoreVoiceIntegrity(text, fingerprint);
}

export function compareVoiceIntegrity(before = '', after = '', fingerprint = {}) {
  const beforeReport = scoreVoiceIntegrity(before, fingerprint);
  const afterReport = scoreVoiceIntegrity(after, fingerprint);
  return {
    before: beforeReport,
    after: afterReport,
    delta: afterReport.score - beforeReport.score,
    improved: afterReport.score >= beforeReport.score,
    authorship_inference: 'not_supported'
  };
}

export function compareHumanScores(before = '', after = '', fingerprint = {}) {
  return compareVoiceIntegrity(before, after, fingerprint);
}
