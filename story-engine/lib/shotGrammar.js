// lib/shotGrammar.js
// Small creator-facing shot commands compiled into provider-neutral production direction.

const COMMAND_ALIASES = Object.freeze({
  '/establish': 'establish',
  '/establishing': 'establish',
  '/dollyin': 'dolly_in',
  '/dolly-in': 'dolly_in',
  '/whippan': 'whip_pan',
  '/whip-pan': 'whip_pan',
  '/rackfocus': 'rack_focus',
  '/rack-focus': 'rack_focus',
  '/hyperlapse': 'hyperlapse',
  '/hyperlaps': 'hyperlapse',
  '/reaction': 'reaction',
  '/insert': 'insert',
  '/close': 'close'
});

export const OPEN_SOURCE_VIDEO_POLICY = Object.freeze({
  schema_version: '1.0.0',
  workflow: 'LEEVIZE',
  shot_contract: 'shot-dna@v1',
  compile_order: Object.freeze(['director-brief', 'model-neutral-shot-spec', 'renderer-adapter']),
  open_source_first: true,
  deterministic_post_tools: Object.freeze(['ffmpeg', 'ffprobe']),
  optional_open_source_candidates: Object.freeze(['remotion', 'comfyui', 'whisper-compatible']),
  candidate_availability_is_runtime_fact: true,
  license_must_be_verified_before_production: true,
  unknown_license_is_blocked: true,
  renderer_adapters_replaceable: true,
  generated_ui_may_prove_product_behavior: false,
  real_product_capture_requires_playwright: true,
  final_audio_precedes_caption_timing: true
});

export const SHOT_COMMANDS = Object.freeze({
  establish: Object.freeze({
    label: 'Establish',
    shot_type: 'establishing',
    camera_move: 'static',
    preview_camera_move: 'static',
    framing: 'wide establishing frame',
    lens: '24mm wide-angle perspective',
    blocking: 'Place characters clearly inside the geography before closer coverage.',
    focus: 'Keep environment and primary subject legible together.',
    motion: 'Hold a calm readable frame with only motivated environmental movement.',
    pacing: 'Let the viewer understand where the scene is before advancing.'
  }),
  dolly_in: Object.freeze({
    label: 'Dolly In',
    shot_type: 'medium',
    camera_move: 'dolly_in',
    preview_camera_move: 'push_in',
    framing: 'medium frame resolving toward a close frame',
    lens: '50mm natural-perspective lens',
    blocking: 'Keep the subject anchored while the camera advances on the emotional beat.',
    focus: 'Maintain focus on the named subject throughout the move.',
    motion: 'Use a controlled forward dolly, not a digital jump or identity-changing morph.',
    pacing: 'Move slowly enough that the emotional change remains readable.'
  }),
  whip_pan: Object.freeze({
    label: 'Whip Pan',
    shot_type: 'medium',
    camera_move: 'whip_pan',
    preview_camera_move: 'pan_right',
    framing: 'fast motivated reframe between story subjects',
    lens: '35mm lens with enough width to preserve geography',
    blocking: 'Start and finish on intentional story information.',
    focus: 'Allow motion blur during the turn, then reacquire the destination cleanly.',
    motion: 'Use one fast directional pan motivated by a reveal or reaction.',
    pacing: 'Treat the pan as punctuation, not continuous visual noise.'
  }),
  rack_focus: Object.freeze({
    label: 'Rack Focus',
    shot_type: 'closeup',
    camera_move: 'rack_focus',
    preview_camera_move: 'static',
    framing: 'layered foreground/background composition',
    lens: '85mm shallow-depth portrait lens',
    blocking: 'Place source and destination subjects on distinct focus planes.',
    focus: 'Shift focus once from the named source subject to the named destination.',
    motion: 'Keep camera movement minimal so the focus transition carries the beat.',
    pacing: 'Hold both ends of the focus pull long enough to register the story change.'
  }),
  hyperlapse: Object.freeze({
    label: 'Hyperlapse',
    shot_type: 'establishing',
    camera_move: 'hyperlapse',
    preview_camera_move: 'pan_right',
    framing: 'wide travel frame with a stable visual anchor',
    lens: '24mm wide-angle lens',
    blocking: 'Preserve a recognizable anchor while time and space compress around it.',
    focus: 'Keep the anchor readable across the accelerated move.',
    motion: 'Compress travel or time progression without changing character identity or scene logic.',
    pacing: 'Use only when elapsed time or distance is part of the story beat.'
  }),
  reaction: Object.freeze({
    label: 'Reaction',
    shot_type: 'closeup',
    camera_move: 'static',
    preview_camera_move: 'static',
    framing: 'close reaction frame',
    lens: '85mm portrait lens',
    blocking: 'Give the reacting subject clear eyeline and uncluttered emotional space.',
    focus: 'Hold focus on the reacting subject.',
    motion: 'Keep camera motion restrained so expression carries the beat.',
    pacing: 'Hold long enough for the reaction to read before cutting.'
  }),
  insert: Object.freeze({
    label: 'Insert',
    shot_type: 'insert',
    camera_move: 'static',
    preview_camera_move: 'static',
    framing: 'tight detail insert',
    lens: '70mm detail lens',
    blocking: 'Isolate one story-relevant object, gesture, or visual clue.',
    focus: 'Keep the selected detail crisp and unambiguous.',
    motion: 'Use no camera movement unless the detail itself moves.',
    pacing: 'Keep the insert concise and story-functional.'
  }),
  close: Object.freeze({
    label: 'Close Emotional Beat',
    shot_type: 'closeup',
    camera_move: 'dolly_in',
    preview_camera_move: 'push_in',
    framing: 'close emotional frame',
    lens: '85mm portrait lens',
    blocking: 'Center the final emotional information without changing established geography.',
    focus: 'Hold the primary subject in clean focus.',
    motion: 'Use a subtle final push only if it strengthens the resolution.',
    pacing: 'Land the beat and give the viewer a clean ending image.'
  })
});

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanList(value) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

export function parseShotCommand(value) {
  const raw = clean(value);
  if (!raw.startsWith('/')) throw new Error('Shot command must start with /.');
  const firstSpace = raw.indexOf(' ');
  const token = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
  const command = COMMAND_ALIASES[token];
  if (!command) throw new Error(`Unsupported shot command: ${token}.`);
  const args = firstSpace === -1 ? '' : clean(raw.slice(firstSpace + 1));

  if (command === 'rack_focus') {
    const [subject = '', target = ''] = args.split(/\s*->\s*/, 2).map(clean);
    return { raw, token, command, subject, target, args };
  }

  return { raw, token, command, subject: args, target: '', args };
}

export function shotCommandFor(index, context = {}) {
  const characters = cleanList(context.characters);
  const primary = characters[0] || 'primary subject';
  const secondary = characters[1] || 'story detail';
  const sequence = [
    '/establish',
    `/dolly-in ${primary}`,
    `/rack-focus ${primary} -> ${secondary}`,
    `/reaction ${primary}`,
    '/insert story detail',
    `/close ${primary}`
  ];
  return sequence[Math.abs(Number(index) || 0) % sequence.length];
}

export function compileShotDirection(input = {}) {
  const parsed = parseShotCommand(input.command);
  const spec = SHOT_COMMANDS[parsed.command];
  const action = clean(input.action);
  const emotion = clean(input.emotion);
  const duration = Number(input.duration_seconds) > 0 ? Number(input.duration_seconds) : null;
  const stylePrompt = clean(input.style_prompt);
  const mustPreserve = cleanList(input.must_preserve);
  const negativeConstraints = cleanList(input.negative_constraints);
  const subject = parsed.subject || clean(input.subject) || 'story subject';
  const target = parsed.target || clean(input.target);
  const focus = parsed.command === 'rack_focus' && target
    ? `Rack focus from ${subject} to ${target}. ${spec.focus}`
    : spec.focus;
  const storyJob = clean(input.story_job)
    || (action ? `Advance the story by clearly showing: ${action}` : `Use ${spec.label.toLowerCase()} to deliver one readable story beat.`);
  const openingFrame = clean(input.opening_frame)
    || `${subject} is clearly established in ${spec.framing} before the beat begins.`;
  const endingFrame = clean(input.ending_frame)
    || `${subject} finishes the beat in a stable readable state that can seed the next shot.`;
  const environmentalMotion = clean(input.environmental_motion)
    || 'Use only motivated environmental motion that does not alter canon, identity, geography, or product state.';
  const soundscape = clean(input.soundscape)
    || 'Preserve motivated ambience and Foley. Do not invent dialogue, lyrics, or music cues.';

  const providerPrompt = [
    `SHOT COMMAND: ${parsed.raw}`,
    `STORY JOB: ${storyJob}`,
    `OPENING FRAME: ${openingFrame}`,
    `ENDING FRAME: ${endingFrame}`,
    `SHOT TYPE: ${spec.shot_type}`,
    `CAMERA: ${spec.camera_move}; ${spec.motion}`,
    `FRAMING: ${spec.framing}`,
    `LENS: ${spec.lens}`,
    `BLOCKING: ${spec.blocking}`,
    `FOCUS: ${focus}`,
    `PACING: ${spec.pacing}`,
    `ENVIRONMENTAL MOTION: ${environmentalMotion}`,
    `SOUND: ${soundscape}`,
    action ? `ACTION: ${action}` : '',
    emotion ? `EMOTION: ${emotion}` : '',
    duration ? `DURATION: ${duration}s` : '',
    stylePrompt ? `STYLE: ${stylePrompt}` : '',
    mustPreserve.length ? `CONTINUITY: ${mustPreserve.join(' ')}` : '',
    negativeConstraints.length ? `AVOID: ${negativeConstraints.join(' ')}` : ''
  ].filter(Boolean).join('\n');

  return {
    schema_version: '1.1.0',
    shot_contract: 'shot-dna@v1',
    provider_neutral: true,
    command: parsed.raw,
    command_name: parsed.command,
    label: spec.label,
    story_job: storyJob,
    subject,
    target: target || null,
    shot_type: spec.shot_type,
    camera_move: spec.camera_move,
    preview_camera_move: spec.preview_camera_move,
    framing: spec.framing,
    lens: spec.lens,
    blocking: spec.blocking,
    focus,
    motion: spec.motion,
    pacing: spec.pacing,
    environmental_motion: environmentalMotion,
    soundscape,
    opening_frame: openingFrame,
    ending_frame: endingFrame,
    continuity_constraints: mustPreserve,
    negative_constraints: negativeConstraints,
    open_source_policy: OPEN_SOURCE_VIDEO_POLICY,
    provider_prompt: providerPrompt
  };
}
