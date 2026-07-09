// lib/eli10Contract.js
// The full creative contract for Eli10 (ages 8-12 / grades 4-6) stories.
// This is the source of truth. ghostWriter, Redteam, and audienceLens all import from here.

export const ELI10_CONTRACT = Object.freeze({
  label: 'Eli10',
  age_range: '8–12',
  reading_level: 'grades 4–6',

  // Voice
  voice: Object.freeze({
    sentence_target_words: 14,
    sentence_hard_cap_words: 22,
    long_sentence_ratio_max: 0.25,
    paragraph_max_sentences: 5,
    pov: 'third or first person — choose the most natural; avoid second person except in game formats',
    tense: 'past tense preferred; present tense allowed for high-energy action or picture-book formats',
    fragments_allowed: true,
    contractions_required: true,
    description:
      'Clear, direct, and full of forward motion. Varied rhythm. Short punchy sentences beside longer ones that breathe. Never condescending. Never dumbed down.'
  }),

  // Vocabulary
  vocabulary: Object.freeze({
    policy: 'define_in_context',
    ceiling: 'grades 4–6 everyday language',
    hard_stops: [
      'Do not use academic or legal jargon without immediately explaining it in plain words.',
      'Do not use words a 10-year-old would need a dictionary to understand without context-defining them.',
      'Do not use baby talk, simplified rhymes, or pat-the-bunny constructions.'
    ],
    allowed_complex_words: 'One or two per scene if defined by context or action, not glossary footnote.'
  }),

  // Concept scaffolding
  scaffolding: Object.freeze([
    'Introduce one new idea at a time.',
    'Show cause and effect explicitly — do not leave logical leaps for the reader to fill.',
    'Anchor abstract ideas to concrete objects, places, or character actions the reader can picture.',
    'Use examples before adding nuance.',
    'If a concept has multiple parts, reveal them in order of importance.'
  ]),

  // Emotional range
  emotional: Object.freeze({
    allowed_range: [
      'curiosity', 'fear', 'excitement', 'loneliness', 'pride', 'embarrassment',
      'grief', 'wonder', 'injustice', 'belonging', 'betrayal', 'hope'
    ],
    stakes_model: 'Stakes must feel real and personal. A 10-year-old cares most about: friendships, fairness, being believed, belonging, proving themselves, losing someone they love. Connect macro stakes to one of these.',
    darkness_policy: 'Darkness and loss are allowed. Children experience hard things. Do not flinch, but do not linger in gratuitous detail. Give the character (and reader) a way forward.',
    humor_policy: 'Humor is welcome. Wit over slapstick where possible. Never at the expense of a character’s dignity.',
    emotional_safety: 'Age-appropriate. Not naive — real. Resolve tension or acknowledge it; do not abandon the reader mid-feeling.'
  }),

  // Story structure
  structure: Object.freeze({
    opening: 'Start in-scene or with a character doing something. No throat-clearing, no weather unless the weather is the problem.',
    pacing: 'Move fast. Earn slow moments with emotional weight.',
    chapter_end: 'Each chapter should end on a beat that makes turning the page feel necessary.',
    world_building: 'Reveal the world through what the character touches, smells, hears, and needs — not through narrator explanation.'
  }),

  // Redteam gate thresholds
  redteam: Object.freeze({
    long_sentence_ratio_fail: 0.35,
    average_words_over_cap_fail: 4,
    missing_concrete_detail_fail: true,
    inappropriate_content_fail: true,
    condescending_tone_signals: [
      /\bremember,? kids?\b/i,
      /\blet me explain\b/i,
      /\bas you (may )?know\b/i,
      /\bthat means\b/i,
      /\bin simple terms\b/i,
      /\bsimply put\b/i
    ],
    baby_talk_signals: [
      /\bwiddle\b/i, /\bpwetty\b/i, /\bgoo-?goo\b/i,
      /\boo-?la-?la\b/i, /\bummy\b/i, /\bwuv\b/i
    ]
  })
});

export function eli10VoiceInstruction() {
  const c = ELI10_CONTRACT;
  return [
    `Eli10 creative contract active (ages ${c.age_range}, ${c.reading_level}).`,
    `Voice: ${c.voice.description}`,
    `Sentences: target ${c.voice.sentence_target_words} words, hard cap ${c.voice.sentence_hard_cap_words} words. Fragments allowed. Contractions required.`,
    `Vocabulary: ${c.vocabulary.ceiling}. Define unfamiliar words in context through action, not footnote.`,
    `Scaffolding: ${c.scaffolding.join(' ')}`,
    `Stakes: ${c.emotional.stakes_model}`,
    `Darkness: ${c.emotional.darkness_policy}`,
    `Opening: ${c.structure.opening}`,
    `Pacing: ${c.structure.pacing}`,
    `Never condescending. Never baby talk. Write for a smart 10-year-old who has already read good books.`
  ].join('\n');
}
