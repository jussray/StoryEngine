// lib/ghostWriter.js

import { complete } from './llmClient.js';
import { runBlader } from './blader.js';
import { cleanProseMechanics } from './proseQuality.js';

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

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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
      'preserve the creator’s natural rhythm and supplied voice samples when available',
      'review repeated canned transitions, rhetorical formulas, vague authority, and filler as clusters rather than banning individual words or punctuation'
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
    maxTokens: Math.round(clampNumber(process.env.GHOST_WRITER_MAX_TOKENS, 1800, 256, 8192)),
    temperature: clampNumber(process.env.GHOST_WRITER_TEMPERATURE, 0.72, 0, 1),
    system: [
      'You are Ghost inside L99 Story Engine.',
      'Write original creative prose or script pages from the creator profile.',
      'Preserve the creator’s voice instead of optimizing for AI-detector evasion.',
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
      '- Use specific nouns, character action, sensory detail, and natural sentence rhythm.',
      '- After drafting, self-audit clusters of canned signposting, repeated rhetorical formulas, vague authority, filler, synonym cycling, or padded lists.',
      '- A single familiar word, compound, list of three, or punctuation mark is not a failure. Do not replace precise language merely because it can occur in AI-generated prose.',
      '- Do not invent lived experience, certainty, or emotional texture solely to appear human.',
      '- Return only the draft unit text.'
    ].join('\n')
  };
}

function cadenceReport(text) {
  const sentences = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const lengths = sentences.map(sentence => sentence.trim().split(/\s+/).filter(Boolean).length).filter(Boolean);
  if (lengths.length < 3) return { checked: true, sentence_count: lengths.length, too_uniform: false };
  return {
    checked: true,
    sentence_count: lengths.length,
    shortest: Math.min(...lengths),
    longest: Math.max(...lengths),
    too_uniform: Math.max(...lengths) - Math.min(...lengths) <= 3
  };
}

// Historical command name retained for compatibility. This is now mechanical cleanup
// only. It never substitutes words or punctuation to evade an authorship detector.
export function ghostHumanizePass(text = '') {
  return cleanProseMechanics(text);
}

function fallbackDraft(intent = {}, fingerprint = {}) {
  const unit = MEDIUM_UNIT[fingerprint.medium] || 'story unit';
  return [
    `${intent.title || 'Untitled Story'} — ${unit}`,
    '',
    'Ghost could not reach the writing model, so L99 prepared a review-safe drafting stub instead.',
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
    const baseDraft = ghostHumanizePass(raw);
    const blader = runBlader(baseDraft, fingerprint);
    const draft = blader.text || baseDraft;
    return {
      status: draft ? 'drafted' : 'empty_draft',
      provider: request.provider,
      task: request.task,
      voice_fingerprint: fingerprint,
      draft_unit: draft || fallbackDraft(intent, fingerprint),
      humanize_pass: {
        applied: true,
        policy: 'density-not-blacklist',
        authorship_inference: 'not_supported',
        removed_ai_signals: [],
        cadence: cadenceReport(draft)
      },
      blader_score: blader.blader_score,
      detector_report: blader.detector_report,
      blader
    };
  } catch (error) {
    return {
      status: 'fallback_stub',
      provider: request.provider,
      task: request.task,
      voice_fingerprint: fingerprint,
      draft_unit: fallbackDraft(intent, fingerprint),
      error: error instanceof Error ? error.message : String(error),
      humanize_pass: { applied: false, reason: 'provider_unavailable', policy: 'density-not-blacklist', authorship_inference: 'not_supported' },
      blader_score: 0,
      detector_report: null,
      blader: null
    };
  }
}

export function ghostCommandOptions() {
  return [
    { command: '/ghost draft', description: 'Draft the next story unit using the workspace voice fingerprint.' },
    { command: '/ghost humanize', description: 'Run mechanical cleanup plus a voice-density audit without changing canon or banning words and punctuation.' },
    { command: '/ghost suggest', description: 'Offer next-line or next-beat suggestions without overwriting human text.' },
    { command: '/ghost rewrite', description: 'Create an alternate pass that requires explicit human acceptance.' }
  ];
}
