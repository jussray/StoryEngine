import { canonicalJson } from './makevideoProtocol.js';
import { createHash } from 'node:crypto';

export const VISUAL_GRAMMAR_VERSION = 'visual-grammar/v1';

export const VISUAL_MODES = Object.freeze([
  'handwritten',
  'decision_matrix',
  'infographic',
  'canvas',
  'layers',
  'cycle',
  'diagram',
  'roadmap',
  'sketchnotes',
  'iceberg',
  'blueprint',
  'exploded_view',
  'tree',
  'timeline'
]);

export const VISUAL_MODE_PROFILES = Object.freeze({
  handwritten: Object.freeze({
    job: 'human annotation, emphasis, or a compact personal explanation',
    imageComposition: 'handwritten labels and marks around one focal subject',
    videoReveal: 'stroke_reveal'
  }),
  decision_matrix: Object.freeze({
    job: 'compare options against explicit criteria',
    imageComposition: 'rows and columns with one clear winner or tradeoff pattern',
    videoReveal: 'criteria_then_options'
  }),
  infographic: Object.freeze({
    job: 'compress several facts, metrics, or takeaways into one scan',
    imageComposition: 'modular fact blocks with strong hierarchy',
    videoReveal: 'fact_blocks'
  }),
  canvas: Object.freeze({
    job: 'show a whole system or concept on one spatial field',
    imageComposition: 'one bounded field containing related zones',
    videoReveal: 'pan_and_zoom'
  }),
  layers: Object.freeze({
    job: 'show stacked systems, abstraction levels, or depth',
    imageComposition: 'ordered strata from top to bottom or front to back',
    videoReveal: 'stack_build'
  }),
  cycle: Object.freeze({
    job: 'show a recurring process, feedback loop, or repeatable flywheel',
    imageComposition: 'closed loop with directional stages',
    videoReveal: 'loop_draw'
  }),
  diagram: Object.freeze({
    job: 'explain relationships, flow, architecture, or causality',
    imageComposition: 'nodes, connectors, and labeled relationships',
    videoReveal: 'node_edge_build'
  }),
  roadmap: Object.freeze({
    job: 'show future progression, milestones, or staged execution',
    imageComposition: 'forward path with milestone gates',
    videoReveal: 'milestone_path'
  }),
  sketchnotes: Object.freeze({
    job: 'turn an explanation into compact annotated visual notes',
    imageComposition: 'small drawings, labels, arrows, and keyword anchors',
    videoReveal: 'annotation_reveal'
  }),
  iceberg: Object.freeze({
    job: 'separate visible symptoms from hidden drivers',
    imageComposition: 'small visible surface above a larger hidden structure',
    videoReveal: 'surface_then_below'
  }),
  blueprint: Object.freeze({
    job: 'show a structured plan, layout, or build specification',
    imageComposition: 'precise plan view with labeled components and dimensions when useful',
    videoReveal: 'line_build'
  }),
  exploded_view: Object.freeze({
    job: 'show how parts compose an object, product, or system',
    imageComposition: 'separated components aligned to their assembled position',
    videoReveal: 'disassemble_reassemble'
  }),
  tree: Object.freeze({
    job: 'show hierarchy, taxonomy, inheritance, or branching decisions',
    imageComposition: 'root-to-branch hierarchy with bounded depth',
    videoReveal: 'branch_growth'
  }),
  timeline: Object.freeze({
    job: 'show chronology, sequence, or change over time',
    imageComposition: 'ordered time axis with only the necessary events',
    videoReveal: 'chronological_build'
  })
});

const RULES = Object.freeze([
  ['decision_matrix', /compare|choice|choose|option|criteria|trade.?off|versus|\bvs\b/i],
  ['timeline', /timeline|chronolog|history|over time|before|after|when it happened/i],
  ['roadmap', /roadmap|milestone|future plan|phases?|launch plan|next steps?/i],
  ['tree', /hierarch|taxonomy|branch|family tree|decision tree|parent|child/i],
  ['cycle', /cycle|loop|repeat|recurr|feedback|flywheel/i],
  ['iceberg', /iceberg|hidden|beneath|under the surface|root cause|visible symptom/i],
  ['exploded_view', /exploded|components?|parts?|assembly|inside|how .* fits/i],
  ['layers', /layers?|stack|strata|levels?|depth|tier/i],
  ['blueprint', /blueprint|floor plan|build plan|specification|schematic plan/i],
  ['diagram', /diagram|architecture|flow|relationship|pipeline|system map|cause|process/i],
  ['canvas', /canvas|ecosystem|whole system|spatial map|one page map/i],
  ['infographic', /infographic|metrics?|statistics?|facts?|numbers?|key takeaways?/i],
  ['sketchnotes', /sketchnote|brainstorm|rough notes?|visual notes?|explain casually/i],
  ['handwritten', /handwritten|personal note|annotation|scribble|margin note|callout/i]
]);

function normalizeMode(mode) {
  if (mode === null || mode === undefined || mode === '') return null;
  const normalized = String(mode).trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (!VISUAL_MODES.includes(normalized)) {
    throw new TypeError(`Unsupported visual mode: ${mode}`);
  }
  return normalized;
}

function normalizeAssetKind(assetKind) {
  const value = String(assetKind || 'image').trim().toLowerCase();
  if (!['image', 'video'].includes(value)) throw new TypeError('assetKind must be image or video.');
  return value;
}

export function visualGrammarFingerprint(value) {
  const payload = `${VISUAL_GRAMMAR_VERSION}\n${canonicalJson(value)}`;
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export function inferVisualMode(intent = '') {
  const text = String(intent || '').trim();
  if (!text) return null;
  for (const [mode, pattern] of RULES) {
    if (pattern.test(text)) return mode;
  }
  return null;
}

export function createVisualGrammarSelection(input = {}) {
  const assetKind = normalizeAssetKind(input.assetKind);
  const intent = String(input.intent || '').trim();
  const explicitMode = normalizeMode(input.mode);
  const inferredMode = explicitMode || inferVisualMode(intent);
  const rationale = String(input.rationale || '').trim();
  const truthClass = String(input.truthClass || 'UNKNOWN').trim().toUpperCase();
  const supportingModes = Array.isArray(input.supportingModes)
    ? input.supportingModes.map(normalizeMode).filter(Boolean)
    : [];

  if (new Set(supportingModes).size !== supportingModes.length) {
    throw new TypeError('supportingModes must not contain duplicates.');
  }
  if (inferredMode && supportingModes.includes(inferredMode)) {
    throw new TypeError('A supporting visual mode cannot duplicate the primary mode.');
  }
  if (supportingModes.length > 1) {
    throw new TypeError('Use at most one supporting visual mode unless a higher-level creative ruling explicitly overrides this helper.');
  }

  const profile = inferredMode ? VISUAL_MODE_PROFILES[inferredMode] : null;
  const core = {
    contract: VISUAL_GRAMMAR_VERSION,
    asset_kind: assetKind,
    intent,
    mode: inferredMode,
    supporting_modes: supportingModes,
    rationale: rationale || (inferredMode ? profile.job : 'No visual structure improves comprehension enough to justify one.'),
    image_composition: profile?.imageComposition ?? null,
    video_reveal: assetKind === 'video' ? profile?.videoReveal ?? null : null,
    truth_class: truthClass,
    structure_grants_truth_or_authority: false
  };

  return Object.freeze({
    ...core,
    fingerprint: visualGrammarFingerprint(core),
    authority_granted: false
  });
}

export function bindVisualGrammarToJobSpec(jobSpec = {}, selection) {
  if (!selection || selection.contract !== VISUAL_GRAMMAR_VERSION || !selection.fingerprint) {
    throw new TypeError('A fingerprinted visual grammar selection is required.');
  }
  return {
    ...jobSpec,
    immutable_job_spec: {
      ...(jobSpec.immutable_job_spec || {}),
      visual_grammar: {
        contract: selection.contract,
        asset_kind: selection.asset_kind,
        mode: selection.mode,
        supporting_modes: [...selection.supporting_modes],
        rationale: selection.rationale,
        image_composition: selection.image_composition,
        video_reveal: selection.video_reveal,
        truth_class: selection.truth_class,
        fingerprint: selection.fingerprint,
        structure_grants_truth_or_authority: false
      }
    }
  };
}
