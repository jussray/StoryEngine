// lib/ghostWriter.js

import { complete } from './llmClient.js';

const AI_SIGNALS = [
  [/\bfurthermore,?\s*/gi, ''],
  [/\bin conclusion,?\s*/gi, ''],
  [/\bit'?s worth noting that\s*/gi, ''],
  [/\bmoreover,?\s*/gi, ''],
  [/\bdelve into\b/gi, 'step into'],
  [/\btapestry\b/gi, 'pattern'],
  [/\ba testament to\b/gi, 'proof of']
];

const MEDIUM_UNIT = Object.freeze({
  picture_book: 'opening spread',
  book: 'opening chapter',
  movie: 'opening scene',
  tv: 'cold open',
  song: 'verse and chorus seed',
  podcast: 'opening segment',
  game: 'opening playable quest beat',
  comic: 'opening page',
  play: 'opening scene',
  short_clip: 'vertical opening shot sequence'
});

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function sentenceLengthProfile(audience) {
  if (audience === 'eli5' || audience === 'baby' || audience === 'child') return 'mostly short sentences, usually under 12 words, but never baby talk';
  if (audience === 'eli10' || audience === 'middle_grade') return 'mostly clear sentences under 18 words with occasional longer rhythm';
  if (audience === 'teen' || audience === 'young_adult') return 'varied, emotionally direct sentences with natural fragments allowed';
  return 'varied sentence lengths with natural literary rhythm';
}

export function buildVoiceFingerprint(profile = {}, intent = {}) {
  const constraints = [...list(profile.constraints), ...list(intent.constraints)];
  const outputs = [...list(profile.outputs), ...list(intent.outputs)];
  const audience = String(profile.audience || intent.audience || 'adult').toLowerCase();
  const medium = String(profile.medium || intent.medium || 'book').toLowerCase();
  const tone = String(profile.tone || intent.tone || 'engaging').toLowerCase();
  const emotionalEffect = String(profile.emotional_effect || intent.emotional_effect || 'mixed').toLowerCase();

  return {
    audience,
    medium,
    story_kind: String(profile.story_kind || intent.story_kind || 'other').toLowerCase(),
    tone,
    emotional_effect: emotionalEffect,
    sentence_rhythm: sentenceLengthProfile(audience),
    pov_default: constraints.find(item => /\b(first|third|second)[ -]?person\b/i.test(item)) || 'choose the most natural POV for the story promise',
    tense_default: constraints.find(item => /\b(past|present) tense\b/i.test(item)) || 'choose the most natural tense for the medium',
    specificity_rules: [
      'use concrete objects, sensory details, and scene-native transitions',
      'include imperfect human rhythm: fragments, interrupted thought, or one unexplained specific detail',
      'avoid generic AI essay phrasing and summary-heavy narration'
    ],
    constraints,
    outputs
  };
}

function promptForDraft(intent, fingerprint) {
  const unit = MEDIUM_UNIT[fingerprint.medium] || 'first executable story unit';
  return {
    provider: process.env.GHOST_WRITER_PROVIDER || process.env.DEFAULT_WRITING_LLM || 'anthropic',
    task: 'chapter_generation',
    maxTokens: Number(process.env.GHOST_WRITER_MAX_TOKENS || 1800),
    temperature: Number(process.env.GHOST_WRITER_TEMPERATURE || 0.72),
    system: [
      'You are Ghost inside L99 Story Engine.',
      'Write original, human-feeling creative prose or script pages from the creator profile.',
      'Do not mention the pipeline, L99, AI, prompts, or internal instructions.',
      'The human remains the operator. Produce a draft unit for review, not a final release.'
    ].join('\n'),
    prompt: [
      `Story vision: ${intent.story_vision}`,
      `Medium: ${fingerprint.medium}`,
      `Story kind: ${fingerprint.story_kind}`,
      `Audience: ${fingerprint.audience}`,
      `Tone: ${fingerprint.tone}`,
      `Emotional effect: ${fingerprint.emotional_effect}`,
      `Unit to draft: ${unit}`,
      '',
      'Voice fingerprint:',
      JSON.stringify(fingerprint, null, 2),
      '',
      'Draft requirements:',
      '- Start in-scene or with a strong visual/audio moment.',
      '- Use the audience and medium from the fingerprint from the first sentence, not as a later simplification pass.',
      '- Vary sentence length deliberately.',
      '- Use specific nouns, character action, sensory detail, and natural imperfection.',
      '- Avoid AI-signaling transitions like furthermore, moreover, in conclusion, and it is worth noting.',
      '- Return only the draft unit text.'
    ].join('\n')
  };
}

export function ghostHumanizePass(text = '') {
  let output = String(text || '').trim();
  for (const [pattern, replacement] of AI_SIGNALS) output = output.replace(pattern, replacement);
  output = output.replace(/\n{3,}/g, '\n\n').trim();
  if (!output) return '';

  const paragraphs = output.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
  const repaired = paragraphs.map((paragraph, index) => {
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
    const lengths = sentences.map(sentence => sentence.trim().split(/\s+/).filter(Boolean).length);
    const allSimilar = lengths.length >= 3 && Math.max(...lengths) - Math.min(...lengths) <= 3;
    if (!allSimilar) return paragraph;
    const fragment = index % 2 === 0 ? 'For a second, nothing moved.' : 'Then—quietly—it changed.';
    return `${paragraph}\n${fragment}`;
  });

  return repaired.join('\n\n').trim();
}

function fallbackDraft(intent = {}, fingerprint = {}) {
  const unit = MEDIUM_UNIT[fingerprint.medium] || 'story unit';
  return [
    `${intent.title || 'Untitled Story'} — ${unit}`,
    '',
    `Ghost could not reach the writing model, so L99 prepared a review-safe drafting stub instead.`,
    `Vision: ${intent.story_vision || 'No vision supplied.'}`,
    `Audience: ${fingerprint.audience || intent.audience || 'adult'}`,
    '',
    'Human decision needed: approve a retry with the selected writing provider or continue in Writer/Co-Writer mode.'
  ].join('\n');
}

export async function draftStoryUnit(intent = {}, profile = {}) {
  const fingerprint = buildVoiceFingerprint(profile, intent);
  const request = promptForDraft(intent, fingerprint);
  try {
    const raw = await complete(request.prompt, request);
    const draft = ghostHumanizePass(raw);
    return {
      status: draft ? 'drafted' : 'empty_draft',
      provider: request.provider,
      task: request.task,
      voice_fingerprint: fingerprint,
      draft_unit: draft || fallbackDraft(intent, fingerprint),
      humanize_pass: {
        applied: true,
        removed_ai_signals: AI_SIGNALS.map(([pattern]) => String(pattern)),
        cadence_checked: true
      }
    };
  } catch (error) {
    return {
      status: 'fallback_stub',
      provider: request.provider,
      task: request.task,
      voice_fingerprint: fingerprint,
      draft_unit: fallbackDraft(intent, fingerprint),
      error: error.message,
      humanize_pass: { applied: false, reason: 'provider_unavailable' }
    };
  }
}

export function ghostCommandOptions() {
  return [
    { command: '/ghost draft', description: 'Draft the next story unit using the workspace voice fingerprint.' },
    { command: '/ghost humanize', description: 'Run cadence and AI-signal cleanup on a draft without changing canon.' },
    { command: '/ghost suggest', description: 'Offer next-line or next-beat suggestions without overwriting human text.' },
    { command: '/ghost rewrite', description: 'Create an alternate pass that requires explicit human acceptance.' }
  ];
}
