// lib/audienceLens.js

const LENSES = Object.freeze({
  eli5: {
    label: 'ELI5',
    purpose: 'Explain or tell the story so a five-year-old can follow it without flattening the idea.',
    reading_level: 'grade-1',
    max_sentence_words: 12,
    max_paragraph_sentences: 3,
    vocabulary: 'simple_concrete',
    analogy_style: 'familiar_everyday_objects',
    abstraction_policy: 'translate_into_examples',
    emotional_safety: 'reassuring',
    required_behaviors: [
      'Use concrete nouns and active verbs.',
      'Explain one idea at a time.',
      'Prefer familiar examples over definitions.',
      'Keep stakes understandable and emotionally safe.',
      'Do not use baby talk or talk down to the audience.'
    ]
  },
  eli10: {
    label: 'ELI10',
    purpose: 'Explain or tell the story clearly enough for a ten-year-old while preserving useful detail and nuance.',
    reading_level: 'grades-4-6',
    max_sentence_words: 18,
    max_paragraph_sentences: 5,
    vocabulary: 'clear_moderate',
    analogy_style: 'real_world_systems',
    abstraction_policy: 'define_then_demonstrate',
    emotional_safety: 'age_appropriate',
    required_behaviors: [
      'Define unfamiliar terms in context.',
      'Break complex systems into ordered steps.',
      'Use examples before adding nuance.',
      'Preserve cause and effect.',
      'Do not oversimplify into incorrect information.'
    ]
  }
});

function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map(value => value.trim())
    .filter(Boolean);
}

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

export function getAudienceLens(audience) {
  return LENSES[String(audience || '').toLowerCase()] || null;
}

export function resolveAudienceLens(audience) {
  const lens = getAudienceLens(audience);
  if (!lens) return {
    audience: String(audience || 'adult').toLowerCase(),
    active: false,
    instruction: null
  };
  return {
    audience: String(audience).toLowerCase(),
    active: true,
    ...lens,
    instruction: [
      `${lens.label} audience lens is active.`,
      lens.purpose,
      `Keep most sentences at or below ${lens.max_sentence_words} words.`,
      ...lens.required_behaviors
    ].join(' ')
  };
}

export function evaluateAudienceFit(text, audience) {
  const lens = getAudienceLens(audience);
  if (!lens) return {
    audience: String(audience || 'adult').toLowerCase(),
    active: false,
    passed: true,
    score: 100,
    findings: []
  };

  const allSentences = sentences(text);
  const sentenceLengths = allSentences.map(sentence => words(sentence).length);
  const longSentences = sentenceLengths.filter(length => length > lens.max_sentence_words);
  const averageSentenceWords = sentenceLengths.length
    ? sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length
    : 0;
  const longRatio = sentenceLengths.length ? longSentences.length / sentenceLengths.length : 0;
  const findings = [];

  if (!String(text || '').trim()) {
    findings.push({
      severity: 'critical',
      code: 'audience_lens_empty_output',
      message: `${lens.label} cannot validate empty output.`
    });
  }
  if (longRatio > 0.35) {
    findings.push({
      severity: 'warning',
      code: 'audience_lens_sentence_length',
      message: `${Math.round(longRatio * 100)}% of sentences exceed the ${lens.max_sentence_words}-word ${lens.label} target.`
    });
  }
  if (averageSentenceWords > lens.max_sentence_words + 2) {
    findings.push({
      severity: 'warning',
      code: 'audience_lens_average_complexity',
      message: `Average sentence length is ${averageSentenceWords.toFixed(1)} words, above the ${lens.label} target.`
    });
  }

  const penalty = findings.reduce((sum, finding) => sum + (finding.severity === 'critical' ? 60 : 15), 0);
  return {
    audience: String(audience).toLowerCase(),
    active: true,
    label: lens.label,
    passed: !findings.some(finding => finding.severity === 'critical'),
    score: Math.max(0, 100 - penalty),
    metrics: {
      sentence_count: sentenceLengths.length,
      average_sentence_words: Number(averageSentenceWords.toFixed(2)),
      max_sentence_words: lens.max_sentence_words,
      long_sentence_ratio: Number(longRatio.toFixed(3))
    },
    findings
  };
}

export const AUDIENCE_LENS_OPTIONS = Object.freeze({
  supported: Object.keys(LENSES),
  lenses: LENSES
});
