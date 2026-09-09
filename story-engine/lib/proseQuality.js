// lib/proseQuality.js
// Phase-aware prose quality observation derived from the L99 Tone Galley / Redteam prototype.
// This is a density-based style-quality heuristic, never an authorship detector.

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

const CONCRETE_HINTS = [
  'block', 'car', 'cash', 'text', 'door', 'seat', 'phone', 'sirens', 'envelope', 'rent',
  'chain', 'corner', 'steps', 'kitchen', 'hallway', 'room', 'table', 'chair', 'window',
  'street', 'bag', 'coat', 'shoes', 'key', 'glass', 'cup', 'plate', 'screen'
];

// Each family has an allowance before it contributes a penalty. A single familiar
// phrase, ordinary word, list structure, or punctuation mark is never a failure.
const TROPE_PATTERNS = Object.freeze({
  em_dash_overuse: { regex: /—/g, weight: 8, allowance: 2 },
  negative_parallelism: { regex: /(not just .*? but also|it'?s not just .*? it'?s|it'?s not .*? it'?s)/gis, weight: 10, allowance: 1 },
  formal_filler: { regex: /(it is important to note|it'?s worth noting|in conclusion|at its core|in today'?s [^,.!?;:]+)/gi, weight: 8, allowance: 1 },
  loaded_vocabulary_cluster: { regex: /\b(delve|tapestry|underscore|foster|enhance|robust|leverage|meaningful|groundbreaking|seamless|ever-evolving|state-of-the-art)\b/gi, weight: 6, allowance: 2 },
  rule_of_three: { regex: /\b\w+,\s+\w+,\s+and\s+\w+\b/gi, weight: 5, allowance: 1 },
  rhetorical_result: { regex: /\b(The result\?|What happens next\?|Why does this matter\?)/gi, weight: 6, allowance: 1 },
  stacked_transitions: { regex: /\b(Moreover|Furthermore|Additionally|Consequently|Importantly)\b/gi, weight: 5, allowance: 1 },
  grand_summary: { regex: /\b(journey|complexity|survival|truth|emotion|pain|love|loyalty)\b/gi, weight: 3, allowance: 6 }
});

function matches(text, regex) {
  return [...String(text || '').matchAll(regex)].length;
}

function sentenceList(text) {
  return String(text || '').split(/[.!?]+/).map(value => value.trim()).filter(Boolean);
}

function words(text) {
  return String(text || '').match(/\b[\w']+\b/g) || [];
}

function fingerprint(text, phase, mode) {
  return createHash('sha256')
    .update(`prose-quality-v2\0${mode || ''}\0${phase || ''}\0${String(text || '')}`)
    .digest('hex')
    .slice(0, 24);
}

export function cleanProseMechanics(text = '') {
  return String(text || '')
    .trim()
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function detectProsePatterns(text) {
  const patterns = {};
  let familyPenalty = 0;
  let rawHits = 0;
  let activeFamilies = 0;

  for (const [name, rule] of Object.entries(TROPE_PATTERNS)) {
    const count = matches(text, rule.regex);
    const excess = Math.max(0, count - rule.allowance);
    const score = excess * rule.weight;
    if (count > 0) activeFamilies += 1;
    rawHits += count;
    familyPenalty += score;
    patterns[name] = { count, score, weight: rule.weight, allowance: rule.allowance };
  }

  const crossFamilyCluster = rawHits >= 3 && activeFamilies >= 2;
  const repeatedSingleFamilyCluster = rawHits >= 4 && activeFamilies === 1;
  const clustered = crossFamilyCluster || repeatedSingleFamilyCluster || familyPenalty > 0;
  const clusterPenalty = crossFamilyCluster
    ? Math.max(0, rawHits - 2) * 3 + Math.max(0, activeFamilies - 1) * 2
    : 0;

  return {
    total_pattern_score: Math.min(100, familyPenalty + clusterPenalty),
    raw_hits: rawHits,
    active_families: activeFamilies,
    clustered,
    patterns
  };
}

export function analyzeProse(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const sentences = sentenceList(raw);
  const tokenList = words(raw);
  const avgSentence = tokenList.length / Math.max(sentences.length, 1);
  const fragments = sentences.filter(sentence => words(sentence).length < 6).length;
  const emDashCount = (raw.match(/—/g) || []).length;
  const concreteHits = CONCRETE_HINTS.filter(hint => new RegExp(`\\b${hint}\\b`, 'i').test(raw));
  const numericAnchors = (raw.match(/(?:[$£€]\s?\d|\b\d{1,4}(?::\d{2})?\b)/g) || []).length;
  const contractions = (raw.match(/\b\w+'\w+\b/g) || []).length;
  const abstractWords = (lower.match(/\b(love|pain|complexity|journey|survival|truth|emotion|feeling|loyalty)\b/g) || []).length;
  const hasContradiction = /\b(but|though|except|instead|lied|lying|swore|promised|turned|hid|hiding)\b/i.test(raw);
  const hasConcreteDetail = concreteHits.length > 0 || numericAnchors > 0;
  const trope = detectProsePatterns(raw);

  // Legacy `aiish_score` is retained for API compatibility. Its semantics are now
  // synthetic-style density only. It cannot identify who or what authored the text.
  const syntheticDensityScore = trope.total_pattern_score;
  const voiceGrip = Math.max(
    0,
    Math.min(
      100,
      55 +
        Math.min((concreteHits.length + Math.min(numericAnchors, 2)) * 5, 20) +
        Math.min(contractions * 3, 12) -
        Math.round(syntheticDensityScore * 0.35) -
        Math.max(0, fragments - 4) * 3
    )
  );
  const melodramaScore = Math.min(
    100,
    Math.max(0, abstractWords - 6) * 4 +
      Math.max(0, fragments - 4) * 6 +
      Math.max(0, emDashCount - 2) * 5
  );

  return {
    aiish_score: syntheticDensityScore,
    synthetic_density_score: syntheticDensityScore,
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
    pattern_hits: Object.entries(trope.patterns).filter(([, value]) => value.count > 0).map(([name]) => name),
    style_density: {
      raw_hits: trope.raw_hits,
      active_families: trope.active_families,
      clustered: trope.clustered
    },
    patterns: trope.patterns,
    authorship_inference: 'not_supported'
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
      continuity_cookie: `prose-quality:v2:${fp}:${phase || 'unphased'}:${mode}`,
      authorship_inference: 'not_supported',
      note: 'No phase threshold was applied. Style-density scores are writing-quality signals, not proof of AI authorship.'
    };
  }

  const failures = [];
  if (analysis.synthetic_density_score > thresholds.max_aiish_score) failures.push('Synthetic style density above threshold');
  if (analysis.voice_grip < thresholds.min_voice_grip) failures.push('Voice grip below threshold');
  if (analysis.melodrama_score > thresholds.max_melodrama_score) failures.push('Melodrama above threshold');
  if (analysis.pattern_score > thresholds.max_pattern_score) failures.push('Pattern density above threshold');
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
    continuity_cookie: `prose-quality:v2:${fp}:${phase}:${mode}`,
    authorship_inference: 'not_supported',
    note: 'Density-based prose quality gate. Individual words, punctuation, or isolated rhetorical patterns are not failures and never establish authorship.'
  };
}
