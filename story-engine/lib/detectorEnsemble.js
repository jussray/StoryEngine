// lib/detectorEnsemble.js

const AI_SIGNAL_PATTERNS = [
  /\bfurthermore\b/i,
  /\bin conclusion\b/i,
  /\bit'?s worth noting\b/i,
  /\bmoreover\b/i,
  /\badditionally\b/i,
  /\bneedless to say\b/i,
  /\bin other words\b/i,
  /\bunderscores\b/i,
  /\bshowcase\b/i,
  /\bembark\b/i,
  /\bdelve into\b/i,
  /\btapestry\b/i,
  /\bbeacon\b/i,
  /\ba testament to\b/i,
  /\bever-evolving\b/i,
  /\bseamlessly\b/i,
  /\brobust\b/i,
  /\butilize\b/i,
  /\bleverage\b/i,
  /\btransformative\b/i
];

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

function aiSignalDensity(text, tokenCount) {
  const hits = AI_SIGNAL_PATTERNS.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
  return { hits, density: tokenCount ? hits / Math.max(1, tokenCount / 100) : 0 };
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

export function scoreHumanLikeness(text = '', fingerprint = {}) {
  const raw = String(text || '').trim();
  const tokenList = words(raw);
  const sentenceList = sentences(raw);
  const sentenceLengths = sentenceList.map(sentence => words(sentence).length).filter(Boolean);
  const sentenceVariance = variance(sentenceLengths);
  const burstiness = Math.sqrt(sentenceVariance);
  const avgSentence = average(sentenceLengths);
  const unique = uniqueRatio(tokenList);
  const signals = aiSignalDensity(raw, tokenList.length);
  const repetitionPenalty = tokenList.length ? Math.max(0, 1 - unique) : 1;
  const fingerprintScore = fingerprintMatchScore(raw, fingerprint);

  const burstinessScore = clamp(Math.min(100, burstiness * 9 + (sentenceLengths.length >= 3 ? 20 : 0)));
  const perplexityProxy = clamp(unique * 85 + Math.min(15, burstiness * 2));
  const sentenceVarianceScore = clamp(sentenceVariance >= 6 ? 85 : sentenceVariance * 12);
  const aiSignalScore = clamp(100 - signals.density * 34);
  const repetitionScore = clamp(100 - repetitionPenalty * 45);

  const composite = clamp(
    burstinessScore * 0.18 +
    perplexityProxy * 0.22 +
    sentenceVarianceScore * 0.16 +
    aiSignalScore * 0.22 +
    fingerprintScore * 0.16 +
    repetitionScore * 0.06
  );

  return {
    score: composite,
    threshold: Number(process.env.BLADER_HUMAN_SCORE_THRESHOLD || 72),
    passed: composite >= Number(process.env.BLADER_HUMAN_SCORE_THRESHOLD || 72),
    signals: {
      word_count: tokenList.length,
      sentence_count: sentenceList.length,
      avg_sentence_length: Number(avgSentence.toFixed(2)),
      sentence_length_variance: Number(sentenceVariance.toFixed(2)),
      burstiness: Number(burstiness.toFixed(2)),
      unique_word_ratio: Number(unique.toFixed(3)),
      ai_signal_hits: signals.hits,
      ai_signal_density: Number(signals.density.toFixed(3)),
      burstiness_score: burstinessScore,
      perplexity_proxy_score: perplexityProxy,
      sentence_variance_score: sentenceVarianceScore,
      ai_signal_score: aiSignalScore,
      fingerprint_match_score: fingerprintScore,
      repetition_score: repetitionScore
    }
  };
}

export function compareHumanScores(before = '', after = '', fingerprint = {}) {
  const beforeReport = scoreHumanLikeness(before, fingerprint);
  const afterReport = scoreHumanLikeness(after, fingerprint);
  return {
    before: beforeReport,
    after: afterReport,
    delta: afterReport.score - beforeReport.score,
    improved: afterReport.score >= beforeReport.score
  };
}
