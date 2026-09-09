// lib/proseQuality.js
// Phase-aware prose quality observation derived from the L99 Tone Galley / Redteam prototype.
// This is a style-quality heuristic, not an authorship detector.

import { createHash } from 'node:crypto';

export const PROSE_QUALITY_MODES = Object.freeze({
  lindymode_default: Object.freeze({
    setup: { max_aiish_score: 28, min_voice_grip: 62, max_melodrama_score: 30, max_pattern_score: 28, require_concrete_detail: true, require_contradiction: false },
    falling_in_love: { max_aiish_score: 26, min_voice_grip: 64, max_melodrama_score: 28, max_pattern_score: 26, require_concrete_detail: true, require_contradiction: false },
    retreat: { max_aiish_score: 24, min_voice_grip: 68, max_melodrama_score: 35, max_pattern_score: 24, require_concrete_detail: true, require_contradiction: true },
    fight_for_love: { max_aiish_score: 30, min_voice_grip: 66, max_melodrama_score: 42, max_pattern_score: 30, require_concrete_detail: true, require_contradiction: true },
    aftermath: { max_aiish_score: 20, min_voice_grip: 65, max_melodrama_score: 20, max_pattern_score: 20, require_concrete_detail: true, require_contradiction: false }
  }),
  redteam_strict: Object.freeze({
    setup: { max_aiish_score: 22, min_voice_grip: 65, max_melodrama_score: 24, max_pattern_score: 22, require_concrete_detail: true, require_contradiction: false },
    falling_in_love: { max_aiish_score: 22, min_voice_grip: 66, max_melodrama_score: 24, max_pattern_score: 22, require_concrete_detail: true, require_contradiction: false },
    retreat: { max_aiish_score: 18, min_voice_grip: 72, max_melodrama_score: 30, max_pattern_score: 18, require_concrete_detail: true, require_contradiction: true },
    fight_for_love: { max_aiish_score: 24, min_voice_grip: 70, max_melodrama_score: 36, max_pattern_score: 22, require_concrete_detail: true, require_contradiction: true },
    aftermath: { max_aiish_score: 16, min_voice_grip: 68, max_melodrama_score: 16, max_pattern_score: 16, require_concrete_detail: true, require_contradiction: false }
  })
});

const AI_PATTERNS = [
  'it is important to note', 'in conclusion', 'it became clear', 'it became abundantly clear',
  'not just', 'but also', 'tapestry', 'underscore', 'foster', 'delve', 'enhance',
  'meaningful', 'shared journey', "in today's", 'at its core', 'honestly'
];

const CONCRETE_HINTS = [
  'block', 'car', 'cash', 'text', 'door', 'seat', 'phone', 'sirens', 'envelope', 'rent',
  'chain', 'corner', 'steps', 'kitchen', 'hallway', 'room', 'table', 'chair', 'window',
  'street', 'bag', 'coat', 'shoes', 'key', 'glass', 'cup', 'plate', 'screen'
];

const TROPE_PATTERNS = Object.freeze({
  em_dash_overuse: { regex: /—/g, weight: 8, threshold: 2 },
  not_x_but_y: { regex: /(not just .*? but also|it'?s not just .*? it'?s|it'?s not .*? it'?s)/gis, weight: 12, threshold: 0 },
  formal_filler: { regex: /(it is important to note|it'?s worth noting|in conclusion|at its core|in today'?s [^,.!?;:]+)/gi, weight: 10, threshold: 0 },
  hype_words: { regex: /\b(delve|tapestry|underscore|foster|enhance|robust|leverage|meaningful|groundbreaking|seamless|ever-evolving|state-of-the-art)\b/gi, weight: 9, threshold: 0 },
  rule_of_three: { regex: /\b\w+,\s+\w+,\s+and\s+\w+\b/gi, weight: 6, threshold: 1 },
  rhetorical_result: { regex: /\b(The result\?|What happens next\?|Why does this matter\?)/gi, weight: 7, threshold: 0 },
  stacked_transitions: { regex: /\b(Moreover|Furthermore|Additionally|Consequently|Importantly)\b/gi, weight: 5, threshold: 1 },
  grand_summary: { regex: /\b(journey|complexity|survival|truth|emotion|pain|love|loyalty)\b/gi, weight: 3, threshold: 6 }
});

function matches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function sentenceList(text) {
  return String(text || '').split(/[.!?]+/).map(value => value.trim()).filter(Boolean);
}

function words(text) {
  return String(text || '').match(/\b[\w']+\b/g) || [];
}

function fingerprint(text, phase, mode) {
  return createHash('sha256')
    .update(`prose-quality-v1\0${mode || ''}\0${phase || ''}\0${String(text || '')}`)
    .digest('hex')
    .slice(0, 24);
}

export function detectProsePatterns(text) {
  const patterns = {};
  let total = 0;
  for (const [name, rule] of Object.entries(TROPE_PATTERNS)) {
    const count = matches(String(text || ''), rule.regex);
    const score = Math.max(0, count - rule.threshold) * rule.weight;
    patterns[name] = { count, score, weight: rule.weight, threshold: rule.threshold };
    total += score;
  }
  return { total_pattern_score: Math.min(100, total), patterns };
}

export function analyzeProse(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const sentences = sentenceList(raw);
  const tokenList = words(raw);
  const avgSentence = tokenList.length / Math.max(sentences.length, 1);
  const fragments = sentences.filter(sentence => words(sentence).length < 6).length;
  const emDashCount = (raw.match(/—/g) || []).length;
  const patternHits = AI_PATTERNS.filter(pattern => lower.includes(pattern));
  const concreteHits = CONCRETE_HINTS.filter(hint => new RegExp(`\\b${hint}\\b`, 'i').test(raw));
  const numericAnchors = (raw.match(/(?:[$£€]\s?\d|\b\d{1,4}(?::\d{2})?\b)/g) || []).length;
  const contractions = (raw.match(/\b\w+'\w+\b/g) || []).length;
  const abstractWords = (lower.match(/\b(love|pain|complexity|journey|survival|truth|emotion|feeling|loyalty)\b/g) || []).length;
  const hasContradiction = /\b(but|though|except|instead|lied|lying|swore|promised|turned|hid|hiding)\b/i.test(raw);
  const hasConcreteDetail = concreteHits.length > 0 || numericAnchors > 0;

  const aiishScore = Math.min(
    100,
    patternHits.length * 12 +
      Math.max(0, fragments - 2) * 6 +
      Math.max(0, emDashCount - 1) * 8 +
      (avgSentence > 28 ? 12 : 0) +
      (hasConcreteDetail ? 0 : 14)
  );

  const voiceGrip = Math.max(
    0,
    Math.min(
      100,
      55 +
        Math.min((concreteHits.length + Math.min(numericAnchors, 2)) * 5, 20) +
        Math.min(contractions * 3, 12) -
        patternHits.length * 8 -
        Math.max(0, fragments - 3) * 4
    )
  );

  const melodramaScore = Math.min(
    100,
    abstractWords * 4 + Math.max(0, fragments - 3) * 7 + emDashCount * 5
  );

  const trope = detectProsePatterns(raw);
  return {
    aiish_score: aiishScore,
    voice_grip: voiceGrip,
    melodrama_score: melodramaScore,
    pattern_score: trope.total_pattern_score,
    avg_sentence_words: Number(avgSentence.toFixed(2)),
    word_count: tokenList.length,
    fragments,
    em_dash_count: emDashCount,
    concrete_hits: concreteHits,
    numeric_anchors: numericAnchors,
    has_concrete_detail: hasConcreteDetail,
    has_contradiction: hasContradiction,
    pattern_hits: patternHits,
    patterns: trope.patterns
  };
}

export function evaluateProseQuality(text, options = {}) {
  const phase = String(options.phase || '').trim();
  const mode = String(options.mode || 'lindymode_default').trim();
  const analysis = analyzeProse(text);
  const fp = fingerprint(text, phase, mode);
  const thresholds = PROSE_QUALITY_MODES[mode]?.[phase] || null;

  if (!thresholds) {
    return {
      status: 'OBSERVE',
      phase: phase || null,
      mode,
      failures: [],
      analysis,
      thresholds: null,
      fingerprint: fp,
      continuity_cookie: `prose-quality:v1:${fp}:${phase || 'unphased'}:${mode}`,
      note: 'No phase threshold was applied. Scores are quality signals, not proof of AI authorship.'
    };
  }

  const failures = [];
  if (analysis.aiish_score > thresholds.max_aiish_score) failures.push('AI-ish score above threshold');
  if (analysis.voice_grip < thresholds.min_voice_grip) failures.push('Voice grip below threshold');
  if (analysis.melodrama_score > thresholds.max_melodrama_score) failures.push('Melodrama above threshold');
  if (analysis.pattern_score > thresholds.max_pattern_score) failures.push('Pattern score above threshold');
  if (thresholds.require_concrete_detail && !analysis.has_concrete_detail) failures.push('Missing concrete detail');
  if (thresholds.require_contradiction && !analysis.has_contradiction) failures.push('Missing contradiction signal');

  return {
    status: failures.length ? 'FAIL' : 'PASS',
    phase,
    mode,
    failures,
    analysis,
    thresholds,
    fingerprint: fp,
    continuity_cookie: `prose-quality:v1:${fp}:${phase}:${mode}`,
    note: 'Density-based prose quality gate. A single phrase or punctuation mark is not treated as proof of AI authorship.'
  };
}
