import { createHash } from 'node:crypto';

export const VIDEO_CONTINUITY_COOKIE_CONTRACT = 'leevize/video-continuity-cookie@v1';
export const VIDEO_PROOF_COOKIE_CONTRACT = 'leevize/video-proof-cookie@v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

function clean(value) {
  return String(value ?? '').trim();
}

export function continuityBasis(job) {
  const blueprint = job?.blueprint || {};
  return {
    source_revision_id: clean(job?.source_revision_id || blueprint.source_revision_id),
    workspace_id: clean(job?.workspace_id || blueprint.workspace_id),
    target_mode: clean(blueprint.target_mode),
    visual_style: clean(blueprint.visual_style),
    aspect_ratio: clean(blueprint.aspect_ratio),
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
  const full_hash = sha256(basis);
  return Object.freeze({
    contract: VIDEO_CONTINUITY_COOKIE_CONTRACT,
    value: `lvz_cc_${full_hash.slice(0, 24)}`,
    full_hash,
    source_revision_id: basis.source_revision_id,
    shot_count: basis.shots.length,
    authority: 'none',
    secret: false,
    purpose: 'bidirectional continuity and staleness marker only'
  });
}

export function verifyContinuityCookie(job, suppliedCookie) {
  const current = createContinuityCookie(job);
  const supplied = clean(typeof suppliedCookie === 'string' ? suppliedCookie : suppliedCookie?.value);
  return Object.freeze({
    contract: VIDEO_CONTINUITY_COOKIE_CONTRACT,
    matches: Boolean(supplied) && supplied === current.value,
    current: current.value,
    supplied: supplied || null,
    stale: Boolean(supplied) && supplied !== current.value,
    authority_granted: false
  });
}

export function createProofCookie(job, evidence = {}) {
  const continuity = createContinuityCookie(job);
  const evidenceHash = sha256({
    continuity_cookie: continuity.value,
    evidence_class: clean(evidence.evidence_class || evidence.class || 'unknown'),
    output_sha256: clean(evidence.output_sha256 || evidence.content_hash),
    renderer: clean(evidence.renderer),
    workflow_sha256: clean(evidence.workflow_sha256),
    media_probe: evidence.media_probe || null
  });
  return Object.freeze({
    contract: VIDEO_PROOF_COOKIE_CONTRACT,
    value: `lvz_pc_${evidenceHash.slice(0, 24)}`,
    continuity_cookie: continuity.value,
    evidence_hash: evidenceHash,
    authority: 'none',
    secret: false,
    purpose: 'proof continuity marker only'
  });
}

export function classifyReceiptContinuity(job, receipt = {}) {
  const continuity = verifyContinuityCookie(job, receipt.continuity_cookie);
  return Object.freeze({
    ...continuity,
    receipt_status: continuity.matches ? 'CURRENT' : receipt.continuity_cookie ? 'STALE' : 'UNBOUND',
    invalidates_old_green: continuity.stale,
    authority_granted: false
  });
}
