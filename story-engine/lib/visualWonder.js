const CREATIVE_MODES = new Set(['cinematic-proof', 'mythic-founder', 'dream-product', 'character-story', 'product-experience']);
const EMOTIONS = new Set(['wonder', 'awe', 'tension', 'revelation', 'elegance', 'ambition', 'intimacy', 'inevitability', 'joy', 'safety', 'belonging']);
const MOTION_INTENTS = new Set(['wonder', 'reveal', 'intimacy', 'energy', 'tension', 'explanation']);
const MOTION_RENDERERS = new Set(['static', 'css', 'reanimated', 'ffmpeg', 'remotion', 'generative']);

export const MOTION_LADDER = Object.freeze({
  0: Object.freeze({ name: 'still', purpose: 'No motion required.', renderers: ['static'] }),
  1: Object.freeze({ name: 'camera_motion', purpose: 'Pan, zoom, drift, push, or pull without changing scene content.', renderers: ['css', 'reanimated', 'ffmpeg', 'remotion'] }),
  2: Object.freeze({ name: 'layer_motion', purpose: 'Deterministic parallax, particles, glow, clouds, or foreground drift.', renderers: ['css', 'reanimated', 'ffmpeg', 'remotion'] }),
  3: Object.freeze({ name: 'programmatic_cinema', purpose: 'Composed shots, captions, transitions, typography, audio, and scene sequencing.', renderers: ['ffmpeg', 'remotion'] }),
  4: Object.freeze({ name: 'generative_motion', purpose: 'Pixels inside the scene need to change, such as body, hair, cloth, or environmental motion.', renderers: ['generative'] }),
  5: Object.freeze({ name: 'full_generative_scene', purpose: 'Character, camera, and environment require generative scene synthesis.', renderers: ['generative'] })
});

export const MOTION_RENDERER_OPTIONS = Object.freeze([...MOTION_RENDERERS]);

function text(value, max = 420) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function norm(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function list(value, max = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 160)).filter(Boolean))].slice(0, max);
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function boolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMotionIntent(value, emotions = []) {
  const requested = text(value, 40).toLowerCase();
  if (MOTION_INTENTS.has(requested)) return requested;
  const firstEmotion = text(emotions[0], 40).toLowerCase();
  if (firstEmotion === 'revelation') return 'reveal';
  if (MOTION_INTENTS.has(firstEmotion)) return firstEmotion;
  return 'wonder';
}

export function resolveMotionBrief(input = {}) {
  const visual = input.visual_wonder && typeof input.visual_wonder === 'object' ? input.visual_wonder : {};
  const raw = visual.motion_brief && typeof visual.motion_brief === 'object' ? visual.motion_brief : null;
  const emotions = list(visual.emotional_intent, 2).map((value) => value.toLowerCase());

  if (!raw) {
    return {
      schema_version: '1.0.0',
      generated_default: true,
      intent: normalizeMotionIntent(null, emotions),
      level: 1,
      level_name: MOTION_LADDER[1].name,
      renderer: 'ffmpeg',
      selection_reason: 'Deterministic camera motion is the lowest default level that can add life without changing source pixels.',
      focal_point: { x: 0.5, y: 0.5 },
      intensity: 0.35,
      duration_seconds: number(input.duration_seconds, 8, 1, 60),
      fps: 30,
      aspect_ratio: text(input.aspect_ratio, 12) || '16:9',
      preserve: { identity: true, clothing: true, environment: true, typography: true },
      reduced_motion_fallback: true,
      requires_generative_provider: false,
      vendor_binding: null
    };
  }

  const level = Number.isInteger(Number(raw.level)) ? Number(raw.level) : -1;
  const renderer = text(raw.renderer, 40).toLowerCase();
  const intent = normalizeMotionIntent(raw.intent, emotions);
  const ladder = MOTION_LADDER[level];
  const errors = [];

  if (!ladder) errors.push('visual_wonder.motion_brief.level must be an integer from 0 through 5');
  if (!MOTION_RENDERERS.has(renderer)) errors.push('visual_wonder.motion_brief.renderer must be a replaceable renderer class, not a vendor name');
  if (ladder && MOTION_RENDERERS.has(renderer) && !ladder.renderers.includes(renderer)) {
    errors.push(`visual_wonder.motion_brief.renderer ${renderer} cannot satisfy motion level ${level}`);
  }
  if (raw.vendor || raw.provider || raw.model) errors.push('visual_wonder.motion_brief must not bind the creative contract to a vendor, provider, or model');
  if (raw.reduced_motion_fallback !== true) errors.push('visual_wonder.motion_brief.reduced_motion_fallback must be true');
  if (level > 0 && !text(raw.selection_reason, 240)) errors.push('visual_wonder.motion_brief.selection_reason is required for motion above still');

  const preserve = raw.preserve && typeof raw.preserve === 'object' ? raw.preserve : {};
  if (level >= 4 && preserve.identity !== true) errors.push('visual_wonder.motion_brief.preserve.identity must be true for generative motion');

  if (errors.length) {
    const error = new Error(`VISUAL_WONDER_REJECTED: ${errors.join('; ')}`);
    error.code = 'VISUAL_WONDER_REJECTED';
    error.details = errors;
    throw error;
  }

  return {
    schema_version: '1.0.0',
    generated_default: false,
    intent,
    level,
    level_name: ladder.name,
    renderer,
    selection_reason: text(raw.selection_reason, 240),
    focal_point: {
      x: number(raw.focal_point?.x, 0.5, 0, 1),
      y: number(raw.focal_point?.y, 0.5, 0, 1)
    },
    intensity: number(raw.intensity, 0.35, 0, 1),
    duration_seconds: number(raw.duration_seconds ?? input.duration_seconds, 8, 1, 60),
    fps: [24, 30, 60].includes(Number(raw.fps)) ? Number(raw.fps) : 30,
    aspect_ratio: text(raw.aspect_ratio, 12) || text(input.aspect_ratio, 12) || '16:9',
    preserve: {
      identity: boolean(preserve.identity, true),
      clothing: boolean(preserve.clothing, true),
      environment: boolean(preserve.environment, true),
      typography: boolean(preserve.typography, true)
    },
    reduced_motion_fallback: true,
    requires_generative_provider: level >= 4,
    vendor_binding: null
  };
}

export function requiresVisualWonder(input = {}) {
  return text(input.quality, 40).toLowerCase() === 'hero' || input.public_facing === true;
}

export function validateVisualWonder(input = {}) {
  if (!requiresVisualWonder(input)) return { required: false, state: 'NOT_REQUIRED_FOR_INTERNAL_DRAFT' };

  const visual = input.visual_wonder && typeof input.visual_wonder === 'object' ? input.visual_wonder : {};
  const errors = [];
  const thesis = text(visual.thesis);
  const scene = text(visual.scene_concept);
  const hook = text(visual.visual_hook);
  const motion = text(visual.motion_language);
  const humanOutcome = text(visual.human_outcome);
  const proofBoundary = text(visual.proof_truth_boundary);
  const memoryLine = text(visual.memory_line, 240);
  const mode = text(visual.creative_mode, 80).toLowerCase();
  const emotions = list(visual.emotional_intent, 2).map((value) => value.toLowerCase());

  if (!thesis) errors.push('visual_wonder.thesis is required');
  if (!CREATIVE_MODES.has(mode)) errors.push('visual_wonder.creative_mode is invalid');
  if (emotions.length === 0 || emotions.some((value) => !EMOTIONS.has(value))) errors.push('visual_wonder.emotional_intent is invalid');
  if (!scene) errors.push('visual_wonder.scene_concept is required');
  if (!hook) errors.push('visual_wonder.visual_hook is required');
  if (!motion) errors.push('visual_wonder.motion_language is required');
  if (!humanOutcome) errors.push('visual_wonder.human_outcome is required');
  if (!proofBoundary) errors.push('visual_wonder.proof_truth_boundary is required');
  if (!memoryLine) errors.push('visual_wonder.memory_line is required');
  if (norm(scene) && norm(scene) === norm(thesis)) errors.push('visual_wonder.scene_concept must interpret rather than literally restate the thesis');
  if (norm(hook) && norm(hook) === norm(thesis)) errors.push('visual_wonder.visual_hook must create curiosity rather than restate the thesis');
  if (visual.preserves_human_agency !== true) errors.push('visual_wonder.preserves_human_agency must be true');
  if (visual.uses_manipulative_dark_patterns === true) errors.push('visual_wonder.uses_manipulative_dark_patterns must be false');
  if (errors.length) {
    const error = new Error(`VISUAL_WONDER_REJECTED: ${errors.join('; ')}`);
    error.code = 'VISUAL_WONDER_REJECTED';
    error.details = errors;
    throw error;
  }

  const motionBrief = resolveMotionBrief(input);

  return {
    required: true,
    state: 'CONCEPT_GATE_PASSED',
    motion_brief: motionBrief,
    attack_2000: {
      reasoning_pressure_budget: 2000,
      external_test_count_claimed: false,
      concept_attack_complete: true,
      rendered_artifact_attack_required: true,
      lowest_sufficient_motion_required: true,
      vendor_binding_forbidden: true
    },
  };
}
