// Versioned, provider-neutral creative direction. No inference or release authority.
export const CINEMATIC_PROFILE = 'leevize/cinematic-direction@v1';

function clean(value, limit = 500) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function list(value, max = 12) {
  return Array.isArray(value) ? [...new Set(value.map(item => clean(item, 250)).filter(Boolean))].slice(0, max) : [];
}

export function cinematicDirection(shot, job) {
  const blueprint = job?.blueprint || {};
  if (blueprint.cinematic_profile !== CINEMATIC_PROFILE) return null;
  const direction = shot?.shot_direction || {};
  const world = blueprint.world_bible || {};
  const preserve = list(shot?.must_preserve);
  const negative = [...new Set([...list(shot?.negative_constraints),
    'static poster', 'slideshow', 'camera-only zoom', 'identity drift',
    'unmotivated morphing', 'frozen subject during required action',
    'unrequested text or logos', 'inconsistent lighting and geometry'
  ])];
  const palette = Array.isArray(world.palette) ? list(world.palette, 8).join(', ') : clean(world.palette);
  const fields = [
    ['Scene intent', clean(shot?.provider_prompt || shot?.action || shot?.narration, 3000)],
    ['Visible action', clean(shot?.action)],
    ['Camera', clean(shot?.camera_move || direction.camera_move)],
    ['Opening composition', clean(direction.opening_frame)],
    ['Closing composition', clean(direction.ending_frame)],
    ['Subject continuity', clean(shot?.subject_state)],
    ['Environment continuity', clean(shot?.environment_state)],
    ['Visual language', clean(world.visual_language || blueprint.visual_style)],
    ['Palette', palette],
    ['Keep unchanged', preserve.join('; ')]
  ].filter(([,value]) => value);
  const guidance = [
    'Stage independent subject movement with a readable beginning, progression and endpoint.',
    'Separate subject action, environmental movement and camera movement; animate existing environment elements only where motivated.',
    'Keep the approved reference identity, proportions, materials, wardrobe, spatial relationships and lighting direction stable.',
    'Use a coherent cinematic composition with depth and motivated focus. Do not substitute a zoomed still or a generic dashboard for the requested action.',
    'Do not invent product functionality, real-world evidence, on-screen claims or unauthorized lettering.'
  ];
  return {
    profile: CINEMATIC_PROFILE,
    prompt: [...fields.map(([key,value]) => key + ': ' + value), ...guidance].join('\n'),
    negative: negative.join(', '),
    authority_granted: false
  };
}
