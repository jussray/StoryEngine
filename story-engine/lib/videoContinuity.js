import {
  MAKEVIDEO_PROTOCOL_VERSION,
  makevideoFingerprint,
  rawSha256
} from './makevideoProtocol.js';

export const VIDEO_CONTINUITY_COOKIE_CONTRACT = 'leevize/video-continuity-cookie@v2';
export const VIDEO_PROOF_COOKIE_CONTRACT = 'leevize/video-proof-cookie@v2';

function clean(value) {
  return String(value ?? '').trim().normalize('NFC');
}

function normalizedOutputFingerprint(value) {
  const output = clean(value).toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(output)) return output;
  if (/^[0-9a-f]{64}$/.test(output)) return `sha256:${output}`;
  return output ? makevideoFingerprint('render-output-reference', output) : null;
}

export function continuityBasis(job) {
  const blueprint = job?.blueprint || {};
  return {
    source_revision_id: clean(job?.source_revision_id || blueprint.source_revision_id),
    workspace_id: clean(job?.workspace_id || blueprint.workspace_id),
    target_mode: clean(blueprint.target_mode),
    visual_style: clean(blueprint.visual_style),
    aspect_ratio: clean(blueprint.aspect_ratio),
    canon_versions: blueprint.canon_versions || null,
    character_bible: blueprint.character_bible || [],
    world_bible: blueprint.world_bible || {},
    shots: (blueprint.shots || []).map(shot => ({
      shot_id: clean(shot.shot_id),
      duration_seconds: Number(shot.duration_seconds || 0),
      shot_command: clean(shot.shot_command),
      provider_prompt: clean(shot.provider_prompt),
      must_preserve: Array.isArray(shot.must_preserve) ? shot.must_preserve : [],
      negative_constraints: Array.isArray(shot.negative_constraints) ? shot.negative_constraints : [],
      opening_frame: clean(shot.shot_direction?.opening_frame),
      ending_frame: clean(shot.shot_direction?.ending_frame)
    }))
  };
}

export function createContinuityCookie(job) {
  const basis = continuityBasis(job);
  const continuityFingerprint = makevideoFingerprint('video-continuity-basis', basis);
  const full_hash = rawSha256(continuityFingerprint);
  const fingerprints = Object.freeze({
    continuity: continuityFingerprint,
    source_revision: makevideoFingerprint('video-source-revision', {
      workspace_id: basis.workspace_id,
      source_revision_id: basis.source_revision_id
    }),
    creative_canon: makevideoFingerprint('video-creative-canon', {
      canon_versions: basis.canon_versions,
      character_bible: basis.character_bible,
      world_bible: basis.world_bible
    }),
    shot_plan: makevideoFingerprint('video-shot-plan', basis.shots)
  });
  return Object.freeze({
    contract: VIDEO_CONTINUITY_COOKIE_CONTRACT,
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    value: `lvz_cc_${full_hash.slice(0, 24)}`,
    full_hash,
    fingerprint: continuityFingerprint,
    fingerprints,
    source_revision_id: basis.source_revision_id,
    shot_count: basis.shots.length,
    authority: 'none',
    secret: false,
    browser_cookie: false,
    action_authority: false,
    publish_authority: false,
    credentials_embedded: false,
    purpose: 'bidirectional continuity and staleness marker only'
  });
}

export function verifyContinuityCookie(job, suppliedCookie) {
  const current = createContinuityCookie(job);
  const supplied = clean(typeof suppliedCookie === 'string' ? suppliedCookie : suppliedCookie?.value);
  const suppliedFingerprint = clean(typeof suppliedCookie === 'object' ? suppliedCookie?.fingerprint : '');
  const valueMatches = Boolean(supplied) && supplied === current.value;
  const fingerprintMatches = Boolean(suppliedFingerprint) && suppliedFingerprint === current.fingerprint;
  const matches = valueMatches && (!suppliedFingerprint || fingerprintMatches);
  return Object.freeze({
    contract: VIDEO_CONTINUITY_COOKIE_CONTRACT,
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    matches,
    current: current.value,
    current_fingerprint: current.fingerprint,
    supplied: supplied || null,
    supplied_fingerprint: suppliedFingerprint || null,
    stale: Boolean(supplied) && !matches,
    authority_granted: false
  });
}

export function createProofCookie(job, evidence = {}) {
  const continuity = createContinuityCookie(job);
  const evidenceBasis = {
    continuity_cookie: continuity.value,
    continuity_fingerprint: continuity.fingerprint,
    evidence_class: clean(evidence.evidence_class || evidence.class || 'unknown').toUpperCase(),
    output_fingerprint: normalizedOutputFingerprint(evidence.output_sha256 || evidence.content_hash),
    renderer: clean(evidence.renderer),
    workflow_fingerprint: normalizedOutputFingerprint(evidence.workflow_sha256),
    media_probe: evidence.media_probe || null
  };
  const evidenceFingerprint = makevideoFingerprint('video-proof-evidence', evidenceBasis);
  const evidenceHash = rawSha256(evidenceFingerprint);
  return Object.freeze({
    contract: VIDEO_PROOF_COOKIE_CONTRACT,
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    value: `lvz_pc_${evidenceHash.slice(0, 24)}`,
    continuity_cookie: continuity.value,
    continuity_fingerprint: continuity.fingerprint,
    evidence_hash: evidenceHash,
    evidence_fingerprint: evidenceFingerprint,
    output_fingerprint: evidenceBasis.output_fingerprint,
    authority: 'none',
    secret: false,
    browser_cookie: false,
    action_authority: false,
    publish_authority: false,
    credentials_embedded: false,
    purpose: 'proof continuity marker only'
  });
}

export function classifyReceiptContinuity(job, receipt = {}) {
  const continuity = verifyContinuityCookie(job, {
    value: receipt.continuity_cookie,
    fingerprint: receipt.continuity_fingerprint || null
  });
  return Object.freeze({
    ...continuity,
    receipt_status: continuity.matches ? 'CURRENT' : receipt.continuity_cookie ? 'STALE' : 'UNBOUND',
    invalidates_old_green: continuity.stale,
    authority_granted: false
  });
}

// Structural shot-plan continuity is deliberately separate from rendered-evidence cookies.
// These compatibility exports keep old internal callers on the safe migration path without
// changing proof-cookie authority semantics.
export {
  deriveShotContinuityGate,
  ensureStoryVideoShotContinuityGate as ensureStoryVideoContinuityGate
} from './videoShotContinuityGate.js';
