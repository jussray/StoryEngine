// lib/audienceLens.js
// Audience lens definitions and evaluation.
// Eli10 is the flagship contract — see eli10Contract.js for the full creative spec.

import { ELI10_CONTRACT, eli10VoiceInstruction } from './eli10Contract.js';

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
    purpose: ELI10_CONTRACT.voice.description,
    reading_level: ELI10_CONTRACT.reading_level,
    max_sentence_words: ELI10_CONTRACT.voice.sentence_target_words,
    sentence_hard_cap_words: ELI10_CONTRACT.voice.sentence_hard_cap_words,
    max_paragraph_sentences: ELI10_CONTRACT.voice.paragraph_max_sentences,
    vocabulary: 'clear_moderate',
    analogy_style: 'real_world_systems',
    abstraction_policy: 'define_then_demonstrate',
    emotional_safety: ELI10_CONTRACT.emotional.emotional_safety,
    stakes_model: ELI10_CONTRACT.emotional.stakes_model,
    darkness_policy: ELI10_CONTRACT.emotional.darkness_policy,
    scaffolding: ELI10_CONTRACT.scaffolding,
    required_behaviors: [
      'Define unfamiliar terms in context through action, not footnote.',
      'Break complex systems into ordered steps.',
      'Use examples before adding nuance.',
      'Preserve cause and effect.',
      'Do not oversimplify into incorrect information.',
      'Do not condescend. Write for a smart 10-year-old who has already read good books.',
      'Fragments allowed. Contractions required. Pacing: move fast, earn slow moments.'
    ],
    voice_instruction: eli10VoiceInstruction()
  },
  child: {
    label: 'Child',
    purpose: 'Engaging story appropriate for children (6-9) with clear moral grounding and age-safe stakes.',
    reading_level: 'grades-2-3',
    max_sentence_words: 14,
    max_paragraph_sentences: 4,
    vocabulary: 'simple_clear',
    analogy_style: 'familiar_everyday_objects',
    abstraction_policy: 'translate_into_examples',
    emotional_safety: 'safe_but_real',
    required_behaviors: [
      'Use concrete sensory detail.',
      'Keep cause and effect visible.',
      'Do not condescend.',
      'Stakes should feel real but resolvable.'
    ]
  },
  middle_grade: {
    label: 'Middle Grade',
    purpose: 'Story for readers 8-12 with real stakes, complex friendships, and emotional depth.',
    reading_level: 'grades-4-7',
    max_sentence_words: 20,
    max_paragraph_sentences: 6,
    vocabulary: 'clear_moderate',
    analogy_style: 'real_world_and_invented_systems',
    abstraction_policy: 'define_then_demonstrate',
    emotional_safety: 'age_appropriate',
    required_behaviors: [
      'Real emotional stakes tied to friendship, fairness, and belonging.',
      'Allow darkness without lingering gratuitously.',
      'Voice should feel authentic to the age, not adult-filtered.',
      'Pacing should move forward; earn slow moments.'
    ]
  },
  teen: {
    label: 'Teen',
    purpose: 'Story for teenage readers with full emotional range, identity stakes, and natural voice.',
    reading_level: 'grades-7-10',
    max_sentence_words: 24,
    max_paragraph_sentences: 7,
    vocabulary: 'natural_teen',
    analogy_style: 'cultural_and_personal',
    abstraction_policy: 'trust_the_reader',
    emotional_safety: 'honest',
    required_behaviors: [
      'Full emotional range including grief, rage, desire, shame.',
      'Identity and self-determination are core stakes.',
      'Voice must feel authentic — no adult filtering.',
      'Avoid moralizing; trust the reader to feel the truth.'
    ]
  },
  young_adult: {
    label: 'Young Adult',
    purpose: 'Story for YA readers with adult complexity, high stakes, and full emotional honesty.',
    reading_level: 'grades-9-12',
    max_sentence_words: 28,
    max_paragraph_sentences: 8,
    vocabulary: 'adult_natural',
    analogy_style: 'cultural_personal_universal',
    abstraction_policy: 'trust_the_reader',
    emotional_safety: 'honest_and_complex',
    required_behaviors: [
      'Full adult emotional complexity.',
      'High personal stakes alongside macro stakes.',
      'Literary rhythm and voice.',
      'Do not moralize or over-explain.'
    ]
  }
});

function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function detectCondescension(text, signals) {
  return signals.filter(pattern => pattern.test(text)).map(p => String(p));
}

export function getAudienceLens(audience) {
  return LENSES[String(audience || '').toLowerCase()] || null;
}

export function resolveAudienceLens(audience) {
  const lens = getAudienceLens(audience);
  if (!lens) return { audience: String(audience || 'adult').toLowerCase(), active: false, instruction: null };
  const instruction = lens.voice_instruction || [
    `${lens.label} audience lens is active.`,
    lens.purpose,
    `Keep most sentences at or below ${lens.max_sentence_words} words.`,
    ...lens.required_behaviors
  ].join(' ');
  return { audience: String(audience).toLowerCase(), active: true, ...lens, instruction };
}

export function evaluateAudienceFit(text, audience) {
  const lens = getAudienceLens(audience);
  if (!lens) return { audience: String(audience || 'adult').toLowerCase(), active: false, passed: true, score: 100, findings: [] };

  const allSentences = sentences(text);
  const sentenceLengths = allSentences.map(s => words(s).length);
  const longCap = lens.sentence_hard_cap_words || lens.max_sentence_words;
  const longSentences = sentenceLengths.filter(l => l > longCap);
  const averageSentenceWords = sentenceLengths.length
    ? sentenceLengths.reduce((sum, v) => sum + v, 0) / sentenceLengths.length
    : 0;
  const longRatio = sentenceLengths.length ? longSentences.length / sentenceLengths.length : 0;
  const findings = [];

  if (!String(text || '').trim()) {
    findings.push({ severity: 'critical', code: 'audience_lens_empty_output', message: `${lens.label} cannot validate empty output.` });
  }

  const failRatio = audience === 'eli10'
    ? ELI10_CONTRACT.redteam.long_sentence_ratio_fail
    : 0.35;

  if (longRatio > failRatio) {
    findings.push({
      severity: 'warning',
      code: 'audience_lens_sentence_length',
      message: `${Math.round(longRatio * 100)}% of sentences exceed the ${longCap}-word ${lens.label} cap.`
    });
  }
  if (averageSentenceWords > (lens.max_sentence_words + (audience === 'eli10' ? 2 : 3))) {
    findings.push({
      severity: 'warning',
      code: 'audience_lens_average_complexity',
      message: `Average sentence length is ${averageSentenceWords.toFixed(1)} words, above the ${lens.label} target.`
    });
  }

  // Eli10-specific: condescension and baby-talk gates
  if (audience === 'eli10') {
    const condescending = detectCondescension(text, ELI10_CONTRACT.redteam.condescending_tone_signals);
    const babyTalk = detectCondescension(text, ELI10_CONTRACT.redteam.baby_talk_signals);
    if (condescending.length) {
      findings.push({ severity: 'warning', code: 'eli10_condescending_tone', message: `Condescending phrase detected: ${condescending[0]}` });
    }
    if (babyTalk.length) {
      findings.push({ severity: 'critical', code: 'eli10_baby_talk', message: `Baby-talk pattern detected: ${babyTalk[0]}` });
    }
  }

  const penalty = findings.reduce((sum, f) => sum + (f.severity === 'critical' ? 60 : 15), 0);
  return {
    audience: String(audience).toLowerCase(),
    active: true,
    label: lens.label,
    passed: !findings.some(f => f.severity === 'critical'),
    score: Math.max(0, 100 - penalty),
    metrics: {
      sentence_count: sentenceLengths.length,
      average_sentence_words: Number(averageSentenceWords.toFixed(2)),
      max_sentence_words: longCap,
      long_sentence_ratio: Number(longRatio.toFixed(3))
    },
    findings
  };
}

export const AUDIENCE_LENS_OPTIONS = Object.freeze({ supported: Object.keys(LENSES), lenses: LENSES });
