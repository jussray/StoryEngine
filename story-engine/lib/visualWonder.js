const CREATIVE_MODES = new Set(['cinematic-proof', 'mythic-founder', 'dream-product', 'character-story', 'product-experience']);
const EMOTIONS = new Set(['wonder', 'awe', 'tension', 'revelation', 'elegance', 'ambition', 'intimacy', 'inevitability', 'joy', 'safety', 'belonging']);

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

  return {
    required: true,
    state: 'CONCEPT_GATE_PASSED',
    attack_2000: {
      reasoning_pressure_budget: 2000,
      external_test_count_claimed: false,
      concept_attack_complete: true,
      rendered_artifact_attack_required: true,
    },
  };
}
