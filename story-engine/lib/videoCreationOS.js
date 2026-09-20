// lib/videoCreationOS.js
// FCR / ULTRATHINK creator-facing visual language compiled into provider-neutral direction.

export const VIDEO_CREATION_OS_CONTRACT = 'l99/video-creation-os@v1';

export const VIDEO_CREATION_OS = Object.freeze({
  contract: VIDEO_CREATION_OS_CONTRACT,
  workflow: 'LEEVIZE',
  standalone: true,
  core_formula: Object.freeze([
    'subject',
    'scene',
    'camera',
    'angle',
    'action',
    'composition',
    'effect',
    'focus',
    'color',
    'lighting',
    'output_intent'
  ]),
  prompt_stack: Object.freeze([
    Object.freeze({ id: 'intent', label: 'Intent', question: 'What must the viewer understand or feel?' }),
    Object.freeze({ id: 'story_beat', label: 'Story Beat', question: 'What changes in this shot?' }),
    Object.freeze({ id: 'shot_design', label: 'Shot Design', question: 'How should camera, angle and composition tell it?' }),
    Object.freeze({ id: 'visual_finish', label: 'Visual Finish', question: 'Which focus, color, light or effect earns its place?' }),
    Object.freeze({ id: 'continuity_check', label: 'Continuity Check', question: 'What must remain identical across adjacent shots?' })
  ]),
  rules: Object.freeze([
    'Use one primary camera movement per shot.',
    'Choose the viewing angle before decorative effects.',
    'Effects must support the story beat rather than conceal weak footage.',
    'Color and lighting communicate emotion but never rewrite canon.',
    'Preserve subject, world, geography and approved continuity across shots.'
  ]),
  categories: Object.freeze({
    camera: Object.freeze({
      label: 'Camera & Movement',
      commands: Object.freeze({
        '/pushin': 'controlled move toward the subject',
        '/pullback': 'controlled reveal away from the subject',
        '/followshot': 'track with the moving subject',
        '/orbit': 'move around the subject on a motivated arc',
        '/dolly': 'smooth physical tracking move',
        '/handheld': 'restrained natural handheld motion',
        '/drone': 'motivated aerial camera movement',
        '/timelapse': 'compress visible time progression'
      })
    }),
    angle: Object.freeze({
      label: 'Camera Angles',
      commands: Object.freeze({
        '/groundlevel': 'low ground-level perspective',
        '/birdseye': 'high overhead perspective',
        '/lowangle': 'upward-looking perspective that adds presence',
        '/highangle': 'downward-looking perspective that reveals context',
        '/overhead': 'clean top-down composition',
        '/dutchtilt': 'intentional tilted horizon for tension',
        '/firstperson': 'subjective first-person viewpoint',
        '/shoulder': 'over-the-shoulder conversational viewpoint'
      })
    }),
    action: Object.freeze({
      label: 'Motion & Action',
      commands: Object.freeze({
        '/sprintmode': 'high-energy motivated action',
        '/strollmode': 'relaxed natural movement',
        '/spinreveal': 'controlled rotating reveal',
        '/slowmotion': 'slow the decisive moment for emphasis',
        '/fastforward': 'compress a passage of time',
        '/timestop': 'hold the peak story moment',
        '/weightless': 'gentle floating movement',
        '/dropaction': 'urgent downward or falling movement'
      })
    }),
    composition: Object.freeze({
      label: 'Composition & Framing',
      commands: Object.freeze({
        '/fullscene': 'show enough environment to understand context',
        '/closecrop': 'frame tightly around the subject',
        '/thirdgrid': 'balanced rule-of-thirds composition',
        '/innerframe': 'use architecture or objects to frame the subject',
        '/leadinglines': 'use scene geometry to guide attention',
        '/cleanframe': 'minimal uncluttered composition',
        '/symmetry': 'intentional symmetrical balance',
        '/negative': 'use breathing room as part of the composition'
      })
    }),
    effect: Object.freeze({
      label: 'Camera Effects',
      commands: Object.freeze({
        '/speedblur': 'motivated motion blur that communicates speed',
        '/softbokeh': 'soft defocused background highlights',
        '/sunflare': 'restrained lens flare from a motivated light source',
        '/edgefade': 'subtle edge falloff that supports attention',
        '/duotone': 'two-tone visual treatment',
        '/filmgrain': 'light film texture',
        '/glitch': 'brief story-motivated digital distortion',
        '/prismsplit': 'subtle prism color separation'
      })
    }),
    focus: Object.freeze({
      label: 'Focus & Depth',
      commands: Object.freeze({
        '/isolatefocus': 'separate the subject with controlled depth of field',
        '/gazepoint': 'prioritize the eyes or named gaze target',
        '/rackfocus': 'shift focus once between named planes',
        '/shallowdof': 'use shallow depth for selective attention',
        '/deepfocus': 'keep foreground and background story information readable',
        '/macro': 'show an extreme close detail',
        '/tiltshift': 'use selective focus only when the miniature feel serves the beat',
        '/focuspull': 'perform a motivated cinematic focus transition'
      })
    }),
    color: Object.freeze({
      label: 'Color Grading',
      commands: Object.freeze({
        '/amberlook': 'warm amber-biased grade',
        '/icylook': 'cool clean grade',
        '/coalteal': 'dark neutral and teal cinematic contrast',
        '/highcontrast': 'bold controlled contrast',
        '/mutedtone': 'restrained low-saturation palette',
        '/vibrant': 'rich color with protected skin and highlight detail',
        '/noir': 'monochrome dramatic treatment',
        '/neonwash': 'futuristic neon-biased palette'
      })
    }),
    portrait: Object.freeze({
      label: 'Portrait & Subject',
      commands: Object.freeze({
        '/heroportrait': 'confident intentional profile or hero framing',
        '/glowskin': 'natural flattering skin rendition without plastic smoothing',
        '/halolight': 'clean edge separation around the subject',
        '/headtotoe': 'show the complete subject and stance',
        '/candid': 'natural unstaged body language',
        '/overtheshoulder': 'story-oriented shoulder perspective',
        '/silhouette': 'readable silhouette with preserved identity cues',
        '/environmental': 'portrait that keeps meaningful environment visible'
      })
    }),
    lighting: Object.freeze({
      label: 'Cinematic Lighting',
      commands: Object.freeze({
        '/rimlight': 'motivated rim light that separates the subject',
        '/softwindow': 'broad natural window-style key light',
        '/goldenhour': 'warm low-angle natural light',
        '/moonlight': 'cool low-key night illumination',
        '/neonlight': 'motivated colored practical lighting',
        '/backlight': 'controlled backlight that adds depth',
        '/lowkey': 'shadow-forward dramatic lighting',
        '/highkey': 'bright clean low-ratio lighting'
      })
    })
  })
});

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function canonicalSelection(categoryId, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  if (Array.isArray(rawValue)) throw new Error(`Video Creation OS allows one ${categoryId} command per shot.`);
  const token = clean(rawValue).split(/\s+/, 1)[0].toLowerCase();
  const category = VIDEO_CREATION_OS.categories[categoryId];
  if (!category || !Object.hasOwn(category.commands, token)) {
    throw new Error(`Unsupported ${categoryId} command: ${token || '(empty)'}.`);
  }
  return Object.freeze({
    category: categoryId,
    label: category.label,
    command: token,
    direction: category.commands[token]
  });
}

export function compileVideoCreationStack(input = {}) {
  const source = record(input);
  const rawSelections = record(source.selections);
  const unknownCategories = Object.keys(rawSelections).filter(key => !Object.hasOwn(VIDEO_CREATION_OS.categories, key));
  if (unknownCategories.length) {
    throw new Error(`Unsupported Video Creation OS categories: ${unknownCategories.sort().join(', ')}.`);
  }

  const selections = Object.keys(VIDEO_CREATION_OS.categories)
    .map(categoryId => canonicalSelection(categoryId, rawSelections[categoryId]))
    .filter(Boolean);
  const subject = clean(source.subject) || 'story subject';
  const scene = clean(source.scene) || 'current story beat';
  const outputIntent = clean(source.output_intent) || 'continuity-safe cinematic story shot';
  const baseline = record(source.baseline);
  const baselineParts = [
    clean(baseline.camera) ? `camera baseline: ${clean(baseline.camera)}` : '',
    clean(baseline.framing) ? `framing baseline: ${clean(baseline.framing)}` : '',
    clean(baseline.focus) ? `focus baseline: ${clean(baseline.focus)}` : '',
    clean(baseline.style) ? `style baseline: ${clean(baseline.style)}` : ''
  ].filter(Boolean);
  const selectedParts = selections.map(item => `${item.command} (${item.direction})`);
  const providerDirection = [
    `Subject: ${subject}.`,
    `Scene: ${scene}.`,
    baselineParts.length ? `Existing Shot DNA: ${baselineParts.join('; ')}.` : '',
    selectedParts.length ? `Creator selections: ${selectedParts.join('; ')}.` : 'Creator selections: inherit the existing Shot DNA without adding decorative effects.',
    `Output intent: ${outputIntent}.`,
    'Preserve canon, identity, geography, continuity and truth boundaries. One primary camera movement per shot.'
  ].filter(Boolean).join(' ');

  return Object.freeze({
    contract: VIDEO_CREATION_OS_CONTRACT,
    workflow: VIDEO_CREATION_OS.workflow,
    subject,
    scene,
    output_intent: outputIntent,
    formula: VIDEO_CREATION_OS.core_formula,
    selections: Object.freeze(selections),
    provider_direction: providerDirection,
    authority: Object.freeze({
      plan: true,
      render: false,
      spend: false,
      publish: false,
      truth_reclassification: false
    })
  });
}

export function videoCreationCatalog() {
  return VIDEO_CREATION_OS;
}
