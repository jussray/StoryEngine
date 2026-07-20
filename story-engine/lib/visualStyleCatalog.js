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
    recommended_modes: ['cinematic_3d', 'motion_book'],
    preview_theme: { bg: '#0b1118', panel: '#18212b', accent: '#d2a66f' }
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
  custom: {
    label: 'Custom Art Direction',
    family: 'custom',
    description: 'A creator-written visual direction layered on top of the same continuity-safe blueprint.',
    language: 'creator-defined art direction',
    palette: 'creator-defined',
    negative: ['do not violate locked character identity', 'do not change canon'],
    recommended_modes: ['motion_book', 'cinematic_3d', 'animation_2d', 'stop_motion'],
    preview_theme: { bg: '#101014', panel: '#1c1c22', accent: '#a2a2b0' }
  }
});

export const LEGACY_VIDEO_MODE_ALIASES = Object.freeze({
  cartoon_2d: { mode: 'animation_2d', visual_style: 'hand_drawn_cartoon' },
  anime_2d: { mode: 'animation_2d', visual_style: 'anime' }
});

const DEFAULT_STYLE_BY_MODE = Object.freeze({
  motion_book: 'soft_cinematic_bookish',
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
