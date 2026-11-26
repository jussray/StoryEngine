// lib/visualStyleCatalog.js
// Rendering technology and visual look are separate decisions.

export const VIDEO_RENDER_MODES = Object.freeze({
  motion_book: {
    label: 'Motion Book',
    status: 'active',
    renderer: 'animated_html',
    description: 'Layered browser animatic with camera motion, typography, and readable story cards.',
    negative: ['no provider dependency', 'no identity drift']
  },
  live_action: {
    label: 'Live Action',
    status: 'preview_ready_real_render_required',
    renderer: 'leevize_replaceable_renderer',
    description: 'Action-first human or character footage. The deterministic preview proves the plan only; final delivery requires verified playable footage. Self-hosted/open-weight rendering is primary and paid renderers are optional shot-level fallback.',
    negative: ['no concept-only completion', 'no slideshow-only delivery', 'no static dashboard montage', 'no generic hacker visuals', 'no fake product interaction']
  },
  cinematic_3d: {
    label: 'Cinematic 3D',
    status: 'blueprint_ready',
    renderer: 'motion_book_proxy',
    description: 'Blender-ready blocking manifest with a free Motion Book preview.',
    negative: ['no floating feet', 'no wardrobe drift', 'no camera clipping']
  },
  animation_2d: {
    label: '2D Animation',
    status: 'blueprint_ready',
    renderer: 'motion_book_proxy',
    description: 'Reusable keyframe, cut-out, or hand-drawn animation manifest with a free preview.',
    negative: ['no off-model faces', 'no random costume swaps', 'no inconsistent line language']
  },
  stop_motion: {
    label: 'Stop Motion',
    status: 'blueprint_ready',
    renderer: 'motion_book_proxy',
    description: 'Clay, paper, miniature, or puppet staging manifest with a free preview.',
    negative: ['no scale drift', 'no material drift', 'no impossible puppet deformation']
  }
});

export const VIDEO_VISUAL_STYLES = Object.freeze({
  cinematic_realism: {
    label: 'Cinematic Realism',
    family: '3d',
    description: 'Grounded film lighting, believable materials, practical lenses, and realistic environments.',
    language: 'cinematic realism, natural performance, practical camera grammar, filmic contrast',
    palette: 'natural skin tones, controlled contrast, motivated lighting',
    negative: ['no plastic skin', 'no uncanny faces', 'no glossy game-cutscene look'],
    recommended_modes: ['live_action', 'cinematic_3d', 'motion_book'],
    preview_theme: { bg: '#0b1118', panel: '#18212b', accent: '#d2a66f' }
  },
  bright_human_future: {
    label: 'Bright Human Future',
    family: 'live_action',
    description: 'Bright, airy, optimistic live action with people visibly doing the work in readable real-world spaces.',
    language: 'bright human-centered live action, daylight through large windows, natural performance, over-the-shoulder interaction, clean product-use coverage, generous breathing room',
    palette: 'white, soft sky blue, electric blue, soft violet, warm daylight, natural skin tones',
    negative: ['no cyberpunk darkness', 'no gloomy server rooms', 'no empty dashboard-only shots', 'no unreadable interface text', 'no generic stock-office filler'],
    recommended_modes: ['live_action', 'motion_book'],
    preview_theme: { bg: '#eef7ff', panel: '#ffffff', accent: '#315dff', text: '#102a56', muted: '#58708f', line: '#b8d1ec' }
  },
  family_3d: {
    label: 'Stylized Family 3D',
    family: '3d',
    description: 'Warm expressive 3D animation with clear silhouettes and emotionally readable faces.',
    language: 'stylized family animation, expressive shapes, soft global illumination, readable posing',
    palette: 'warm balanced color, soft bounce light, clean silhouettes',
    negative: ['no copied studio characters', 'no rubbery faces', 'no over-polished plastic skin'],
    recommended_modes: ['cinematic_3d', 'motion_book'],
    preview_theme: { bg: '#101820', panel: '#20303a', accent: '#6fd5ff' }
  },
  hand_drawn_cartoon: {
    label: 'Hand-Drawn Cartoon',
    family: '2d',
    description: 'Expressive linework, squash-and-stretch energy, and reusable character model sheets.',
    language: 'hand-drawn cartoon animation, confident outlines, expressive poses, controlled shape language',
    palette: 'bold clean color blocks with readable contrast',
    negative: ['no off-model heads', 'no random line thickness', 'no copied franchise designs'],
    recommended_modes: ['animation_2d', 'motion_book'],
    preview_theme: { bg: '#19140b', panel: '#2b2416', accent: '#ffd25f' }
  },
  anime: {
    label: 'Anime',
    family: '2d',
    description: 'Consistent cel-shaded character acting, cinematic compositions, and controlled effects.',
    language: 'anime keyframes, cel shading, expressive acting, cinematic rim light, controlled speed lines',
    palette: 'clean cel color, selective glow, dramatic value grouping',
    negative: ['no face drift', 'no hair-color drift', 'no extra fingers'],
    recommended_modes: ['animation_2d', 'motion_book'],
    preview_theme: { bg: '#0d0b16', panel: '#1d1830', accent: '#a77cff' }
  },
  comic_ink: {
    label: 'Comic Ink',
    family: '2d',
    description: 'Graphic-novel framing with inked shadows, halftone texture, and panel-driven impact.',
    language: 'graphic novel ink, strong blacks, halftone texture, dynamic panel composition',
    palette: 'high contrast ink with one controlled accent family',
    negative: ['no muddy values', 'no unreadable speech areas', 'no inconsistent inking style'],
    recommended_modes: ['animation_2d', 'motion_book'],
    preview_theme: { bg: '#100f0f', panel: '#211c1c', accent: '#ff6868' }
  },
  watercolor_storybook: {
    label: 'Watercolor Storybook',
    family: 'illustration',
    description: 'Soft painted edges, visible paper texture, and premium children’s-book warmth.',
    language: 'watercolor storybook illustration, visible paper grain, soft pigment blooms, elegant composition',
    palette: 'gentle layered washes with restrained accents',
    negative: ['no muddy faces', 'no synthetic airbrush look', 'no collapsing paper texture'],
    recommended_modes: ['motion_book', 'animation_2d'],
    preview_theme: { bg: '#11191b', panel: '#1d2a2d', accent: '#82bdca' }
  },
  soft_cinematic_bookish: {
    label: 'Soft Cinematic Bookish',
    family: 'illustration',
    description: 'Premium ebook-reader mood: quiet, cinematic, slightly futuristic, and story-first.',
    language: 'soft cinematic book illustration, restrained depth, elegant typography, subtle futuristic glow',
    palette: 'cool blue-violet, warm paper neutrals, low-saturation atmosphere',
    negative: ['no loud game UI', 'no childish clip art', 'no excessive glow'],
    recommended_modes: ['motion_book', 'animation_2d'],
    preview_theme: { bg: '#0d1018', panel: '#171b29', accent: '#9487ca' }
  },
  clay_stop_motion: {
    label: 'Clay Stop Motion',
    family: 'stop_motion',
    description: 'Handmade clay characters, miniature sets, tactile lighting, and intentional frame texture.',
    language: 'clay stop-motion miniature, handmade fingerprints, practical set lighting, tactile materials',
    palette: 'earthy tactile color with warm practical highlights',
    negative: ['no melted faces', 'no scale inconsistency', 'no glossy CGI clay'],
    recommended_modes: ['stop_motion', 'motion_book'],
    preview_theme: { bg: '#17100c', panel: '#2a1d16', accent: '#dc8d63' }
  },
  paper_cutout: {
    label: 'Paper Cutout',
    family: 'stop_motion',
    description: 'Layered paper shapes, visible fibers, shadow-box depth, and handcrafted movement.',
    language: 'layered paper cutout animation, visible fibers, shadow-box depth, handcrafted silhouettes',
    palette: 'matte paper colors with clear layer separation',
    negative: ['no glossy vector look', 'no flat depthless staging', 'no inconsistent paper grain'],
    recommended_modes: ['stop_motion', 'motion_book', 'animation_2d'],
    preview_theme: { bg: '#11160d', panel: '#20291a', accent: '#82b85e' }
  },
  pixel_art: {
    label: 'Pixel Art',
    family: 'digital',
    description: 'Purposeful limited-resolution art with stable sprites, tile logic, and readable motion.',
    language: 'high-quality pixel art, stable sprite proportions, deliberate clusters, readable silhouette animation',
    palette: 'limited curated palette with strong value separation',
    negative: ['no mixed pixel sizes', 'no blurry scaling', 'no procedural noise masquerading as pixels'],
    recommended_modes: ['animation_2d', 'motion_book'],
    preview_theme: { bg: '#09120e', panel: '#11231a', accent: '#5ee083' }
  },
  neon_noir: {
    label: 'Neon Noir',
    family: 'cinematic',
    description: 'Moody night photography, wet reflections, controlled neon, and graphic silhouettes.',
    language: 'neon noir cinematography, wet reflections, deep silhouettes, selective colored light',
    palette: 'deep indigo, electric violet, cyan, and restrained magenta',
    negative: ['no rainbow overload', 'no crushed unreadable faces', 'no generic cyberpunk clutter'],
    recommended_modes: ['cinematic_3d', 'motion_book', 'animation_2d'],
    preview_theme: { bg: '#070914', panel: '#13162b', accent: '#ff55dc' }
  },
  vintage_animation: {
    label: 'Vintage Animation',
    family: '2d',
    description: 'Retro painted backgrounds, limited animation, film grain, and period shape language.',
    language: 'vintage limited animation, painted backgrounds, period-accurate shape language, subtle film texture',
    palette: 'muted heritage color with warm aged highlights',
    negative: ['no copied legacy characters', 'no fake damage obscuring faces', 'no modern vector sheen'],
    recommended_modes: ['animation_2d', 'motion_book'],
    preview_theme: { bg: '#17130d', panel: '#292116', accent: '#dfa34f' }
  },
  sunset_lotus: {
    label: 'Sunset Lotus',
    family: 'canon',
    canon: true,
    description: 'The Juss & Co house look: a sunset-lotus artwork world in deep violet and gold, Didone serif type, and living ambient motion.',
    language: 'sunset-lotus artwork world, deep violet and gold, Didone serif typography, lotus motifs, warm dusk glow, living ambient motion, smooth load-in rise and gentle parallax',
    palette: 'deep violet, antique gold, warm amber highlights, soft cream type',
    negative: ['no off-brand palettes', 'no flat static frames', 'no generic stock look', 'no sans-serif display type', 'no cold blue corporate grade'],
    recommended_modes: ['motion_book', 'live_action', 'animation_2d'],
    preview_theme: { bg: '#160b26', panel: '#241239', accent: '#e8b34b', text: '#f7efe0', muted: '#c4aed8', line: '#3d2560' }
  },
  luxe_purple_gold: {
    label: 'Luxe Purple & Gold',
    family: 'canon',
    canon: true,
    description: 'The Juss Beautiful Hair look: deep purple and gold with real product photography — satin, ribbon, and true hair texture. Photography only, never an illustrated substitute.',
    language: 'luxe product photography, deep purple and gold, real photography, deep purple satin and ribbon styling, gold props, natural hair texture, true hairlines, fingers through the hair',
    palette: 'deep purple, gold, rich warm skin tones, satin sheen',
    negative: ['no warped or melted lace', 'no hairline drift', 'no plastic or fake-looking hair', 'no grading that changes the true product color', 'no illustrated substitute for real product photography', 'no turns or spins — front shot, hard cut to back shot for length'],
    recommended_modes: ['live_action', 'motion_book'],
    preview_theme: { bg: '#1b0b26', panel: '#2a1240', accent: '#d4af37', text: '#f6ecff', muted: '#c9aee0', line: '#45205f' }
  },
  noir_gold_counsel: {
    label: 'Noir Gold Counsel',
    family: 'canon',
    canon: true,
    description: 'The Truth Weaver look: near-black ground, thin gold line work, white serif capitals, and plain-language authority.',
    language: 'near-black noir counsel, thin gold line work, white serif capitals, restrained gold accents, courthouse line motifs, plain-language authority',
    palette: 'near-black #05080C, thin gold lines, white serif type, gold accents',
    negative: ['no navy background', 'no clutter', 'no cartoon look', 'no stock-photo filler', 'no loud gradients'],
    recommended_modes: ['motion_book', 'live_action', 'animation_2d'],
    preview_theme: { bg: '#05080C', panel: '#0d1117', accent: '#c9a227', text: '#f5f2e8', muted: '#9aa3ab', line: '#2a2f26' }
  },
  storyengine_prism: {
    label: 'StoryEngine Prism',
    family: 'canon',
    canon: true,
    description: 'The StoryEngine wordmark world: pale luminous near-white against a pink-to-violet-to-blue gradient, Playfair Didone display serif, and a soft neon glow.',
    language: 'StoryEngine prism wordmark world, pale luminous near-white, pink-to-violet-to-blue gradient, Playfair Didone display serif, soft neon glow, one shared wordmark treatment on every surface',
    palette: 'luminous near-white #fdfaff, pink #ff6fd8, violet #c05cff, blue #4fb8ff, deep violet-black ground',
    negative: ['no per-page one-off wordmark treatments', 'no external font services', 'no flat matte color replacing the gradient', 'no glow so heavy the type is unreadable'],
    recommended_modes: ['motion_book', 'animation_2d', 'cinematic_3d'],
    preview_theme: { bg: '#0d0a18', panel: '#1a1430', accent: '#c05cff', text: '#fdfaff', muted: '#b9a8e8', line: '#372a5e' }
  },
  custom: {
    label: 'Custom Art Direction',
    family: 'custom',
    description: 'A creator-written visual direction layered on top of the same continuity-safe blueprint.',
    language: 'creator-defined art direction',
    palette: 'creator-defined',
    negative: ['do not violate locked character identity', 'do not change canon'],
    recommended_modes: ['live_action', 'motion_book', 'cinematic_3d', 'animation_2d', 'stop_motion'],
    preview_theme: { bg: '#101014', panel: '#1c1c22', accent: '#a2a2b0' }
  }
});

export const LEGACY_VIDEO_MODE_ALIASES = Object.freeze({
  cartoon_2d: { mode: 'animation_2d', visual_style: 'hand_drawn_cartoon' },
  anime_2d: { mode: 'animation_2d', visual_style: 'anime' }
});

const DEFAULT_STYLE_BY_MODE = Object.freeze({
  motion_book: 'soft_cinematic_bookish',
  live_action: 'bright_human_future',
  cinematic_3d: 'cinematic_realism',
  animation_2d: 'hand_drawn_cartoon',
  stop_motion: 'clay_stop_motion'
});

export function resolveVideoLook(input = {}) {
  const requestedMode = String(input.mode || 'motion_book').trim();
  const legacy = LEGACY_VIDEO_MODE_ALIASES[requestedMode];
  const mode = legacy?.mode || requestedMode;
  const visualStyle = String(input.visual_style || legacy?.visual_style || DEFAULT_STYLE_BY_MODE[mode] || 'soft_cinematic_bookish').trim();
  const customStylePrompt = String(input.custom_style_prompt || '').trim();

  if (!VIDEO_RENDER_MODES[mode]) throw new Error('Unsupported video render mode.');
  if (!VIDEO_VISUAL_STYLES[visualStyle]) throw new Error('Unsupported visual style.');
  if (visualStyle === 'custom' && !customStylePrompt) throw new Error('custom_style_prompt is required for custom art direction.');

  return {
    mode,
    visual_style: visualStyle,
    custom_style_prompt: visualStyle === 'custom' ? customStylePrompt : null,
    mode_contract: VIDEO_RENDER_MODES[mode],
    style_contract: VIDEO_VISUAL_STYLES[visualStyle],
    style_fit: VIDEO_VISUAL_STYLES[visualStyle].recommended_modes.includes(mode) ? 'recommended' : 'experimental'
  };
}
