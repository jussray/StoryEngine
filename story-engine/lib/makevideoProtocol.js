import { createHash } from 'node:crypto';

export const MAKEVIDEO_PROTOCOL_VERSION = 'makevideo/v2.1';
export const MAKEVIDEO_FINGERPRINT_CONTRACT = 'leevize/makevideo-fingerprint@v2.1';

export const CLAIM_CLASSES = Object.freeze([
  'VERIFIED',
  'DEMONSTRATED',
  'DOCUMENTED',
  'TESTIMONIAL',
  'ILLUSTRATIVE',
  'DRAMATIZED',
  'SIMULATED',
  'INFERRED',
  'UNKNOWN'
]);

export const SHOT_OBJECTIVE_STATES = Object.freeze(['OPEN', 'SATISFIED', 'ABANDONED']);
export const JOB_ATTEMPT_STATES = Object.freeze([
  'DRAFT', 'READY', 'SUBMITTED', 'PROVIDER_COMPLETED', 'MEDIA_VALIDATED', 'INSPECTING',
  'REVIEW_PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'PERMANENTLY_FAILED'
]);
export const RELEASE_STATES = Object.freeze([
  'DRAFT', 'ASSEMBLED', 'QA_PENDING', 'RELEASE_CANDIDATE', 'VERIFIED',
  'PUBLISH_APPROVED', 'PUBLISHING', 'PUBLISHED', 'BLOCKED'
]);

const TRANSITIONS = Object.freeze({
  shot_objective: Object.freeze({
    OPEN: Object.freeze(['SATISFIED', 'ABANDONED']),
    SATISFIED: Object.freeze([]),
    ABANDONED: Object.freeze([])
  }),
  job_attempt: Object.freeze({
    DRAFT: Object.freeze(['READY', 'SUPERSEDED']),
    READY: Object.freeze(['SUBMITTED', 'SUPERSEDED', 'PERMANENTLY_FAILED']),
    SUBMITTED: Object.freeze(['PROVIDER_COMPLETED', 'PERMANENTLY_FAILED']),
    PROVIDER_COMPLETED: Object.freeze(['MEDIA_VALIDATED', 'PERMANENTLY_FAILED']),
    MEDIA_VALIDATED: Object.freeze(['INSPECTING', 'PERMANENTLY_FAILED']),
    INSPECTING: Object.freeze(['REVIEW_PENDING', 'REJECTED', 'SUPERSEDED']),
    REVIEW_PENDING: Object.freeze(['APPROVED', 'REJECTED', 'SUPERSEDED']),
    APPROVED: Object.freeze(['SUPERSEDED']),
    REJECTED: Object.freeze([]),
    SUPERSEDED: Object.freeze([]),
    PERMANENTLY_FAILED: Object.freeze([])
  }),
  release: Object.freeze({
    DRAFT: Object.freeze(['ASSEMBLED', 'BLOCKED']),
    ASSEMBLED: Object.freeze(['QA_PENDING', 'BLOCKED']),
    QA_PENDING: Object.freeze(['RELEASE_CANDIDATE', 'BLOCKED']),
    RELEASE_CANDIDATE: Object.freeze(['VERIFIED', 'BLOCKED']),
    VERIFIED: Object.freeze(['PUBLISH_APPROVED', 'BLOCKED']),
    PUBLISH_APPROVED: Object.freeze(['PUBLISHING', 'BLOCKED']),
    PUBLISHING: Object.freeze(['PUBLISHED', 'BLOCKED']),
    PUBLISHED: Object.freeze([]),
    BLOCKED: Object.freeze(['DRAFT', 'ASSEMBLED', 'QA_PENDING', 'RELEASE_CANDIDATE', 'VERIFIED', 'PUBLISH_APPROVED', 'PUBLISHING'])
  })
});

const TRANSIENT_JOB_FIELDS = new Set([
  'submitted_at', 'provider_job_id', 'queue_position', 'polling_status', 'worker_id', 'lease_id',
  'started_at', 'completed_at', 'updated_at', 'current_state', 'execution_receipt'
]);

function normalizeString(value) {
  const normalized = String(value).normalize('NFC');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return normalized;
}

function normalizedNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
  return Object.is(value, -0) ? 0 : value;
}

export function canonicalize(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return normalizedNumber(value);
  if (typeof value === 'string') return normalizeString(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => value[key] !== undefined)
        .sort()
        .map(key => [normalizeString(key), canonicalize(value[key])])
    );
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function makevideoFingerprint(kind, value) {
  const namespace = normalizeString(kind || 'unknown');
  const payload = `${MAKEVIDEO_PROTOCOL_VERSION}\n${namespace}\n${canonicalJson(value)}`;
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export function rawSha256(fingerprint) {
  const value = String(fingerprint || '');
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) throw new TypeError('Expected sha256 fingerprint.');
  return value.slice(7).toLowerCase();
}

function normalizeHash(value) {
  const text = String(value || '').trim().toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(text)) return text;
  if (/^[0-9a-f]{64}$/.test(text)) return `sha256:${text}`;
  return makevideoFingerprint('opaque-input', text);
}

function withoutTransientFields(value) {
  if (Array.isArray(value)) return value.map(withoutTransientFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !TRANSIENT_JOB_FIELDS.has(key))
        .map(([key, item]) => [key, withoutTransientFields(item)])
    );
  }
  return value;
}

export function createShotObjective(input = {}) {
  const objective = {
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    objective_id: String(input.objective_id || '').trim(),
    video_id: String(input.video_id || '').trim(),
    scene_id: String(input.scene_id || '').trim(),
    shot_id: String(input.shot_id || '').trim(),
    requirement: String(input.requirement || '').trim(),
    truth_class: String(input.truth_class || 'UNKNOWN').toUpperCase(),
    status: String(input.status || 'OPEN').toUpperCase()
  };
  if (!objective.objective_id || !objective.shot_id || !objective.requirement) throw new TypeError('objective_id, shot_id, and requirement are required.');
  if (!CLAIM_CLASSES.includes(objective.truth_class)) throw new TypeError('Unsupported truth classification.');
  if (!SHOT_OBJECTIVE_STATES.includes(objective.status)) throw new TypeError('Unsupported shot objective state.');
  return Object.freeze({
    ...objective,
    fingerprint: makevideoFingerprint('shot-objective', objective),
    authority_granted: false
  });
}

export function createJobSpec(input = {}) {
  const immutableJobSpec = withoutTransientFields(input.immutable_job_spec || {});
  const basis = {
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    job_kind: String(input.job_kind || 'VIDEO_RENDER').trim().toUpperCase(),
    objective_id: String(input.objective_id || '').trim(),
    immutable_job_spec: immutableJobSpec,
    canon_versions: input.canon_versions || {},
    adapter_id: String(input.adapter_id || '').trim(),
    adapter_version: String(input.adapter_version || '').trim(),
    bounded_input_hashes: (input.bounded_input_hashes || []).map(normalizeHash).sort(),
    expected_outputs: input.expected_outputs || [],
    cost_ceiling: input.cost_ceiling || { currency: 'USD', amount: 0 },
    retry_ordinal: Number.isInteger(input.retry_ordinal) ? input.retry_ordinal : 0,
    repair_spec: input.repair_spec || null
  };
  if (!basis.objective_id) throw new TypeError('objective_id is required.');
  const idempotencyKey = makevideoFingerprint('job-spec', basis);
  return Object.freeze({
    ...basis,
    idempotency_key: idempotencyKey,
    spec_fingerprint: idempotencyKey,
    authority_granted: false
  });
}

export function isLegalTransition(scope, from, to) {
  const table = TRANSITIONS[String(scope || '')];
  if (!table) return false;
  return Array.isArray(table[from]) && table[from].includes(to);
}

export function createStateEvent(input = {}) {
  const scope = String(input.scope || '').trim();
  const from = String(input.from || '').trim().toUpperCase();
  const to = String(input.to || '').trim().toUpperCase();
  if (!isLegalTransition(scope, from, to)) throw new TypeError(`Illegal ${scope} transition: ${from} -> ${to}`);
  const core = {
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    scope,
    subject_id: String(input.subject_id || '').trim(),
    from,
    to,
    at: normalizeString(input.at || new Date().toISOString()),
    evidence_refs: Array.isArray(input.evidence_refs) ? [...input.evidence_refs] : [],
    reason: input.reason ? String(input.reason).trim() : null,
    previous_event_hash: input.previous_event_hash || null
  };
  if (!core.subject_id) throw new TypeError('subject_id is required.');
  const eventHash = makevideoFingerprint('state-event', core);
  return Object.freeze({ ...core, event_id: `MVS_${rawSha256(eventHash).slice(0, 20)}`, event_hash: eventHash });
}

export function createReceiptEvent(input = {}) {
  const core = {
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    receipt_id: String(input.receipt_id || '').trim(),
    sequence: Number(input.sequence),
    type: String(input.type || '').trim().toUpperCase(),
    at: normalizeString(input.at || new Date().toISOString()),
    payload: input.payload || {},
    previous_event_hash: input.previous_event_hash || null
  };
  if (!core.receipt_id || !Number.isInteger(core.sequence) || core.sequence < 1 || !core.type) {
    throw new TypeError('receipt_id, positive integer sequence, and type are required.');
  }
  const payloadFingerprint = makevideoFingerprint('receipt-payload', core.payload);
  const eventHash = makevideoFingerprint('receipt-event', { ...core, payload_fingerprint: payloadFingerprint });
  return Object.freeze({
    ...core,
    event_id: `RCE_${rawSha256(eventHash).slice(0, 20)}`,
    payload_fingerprint: payloadFingerprint,
    event_hash: eventHash,
    authority_granted: false
  });
}

export function verifyReceiptEventChain(events = []) {
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.sequence !== index + 1) return { valid: false, reason: 'sequence_gap', at: index };
    if ((event.previous_event_hash || null) !== previous) return { valid: false, reason: 'previous_hash_mismatch', at: index };
    const expectedPayload = makevideoFingerprint('receipt-payload', event.payload || {});
    if (event.payload_fingerprint !== expectedPayload) return { valid: false, reason: 'payload_fingerprint_mismatch', at: index };
    const expectedEvent = makevideoFingerprint('receipt-event', {
      protocol_version: event.protocol_version,
      receipt_id: event.receipt_id,
      sequence: event.sequence,
      type: event.type,
      at: event.at,
      payload: event.payload || {},
      previous_event_hash: event.previous_event_hash || null,
      payload_fingerprint: expectedPayload
    });
    if (event.event_hash !== expectedEvent) return { valid: false, reason: 'event_hash_mismatch', at: index };
    previous = event.event_hash;
  }
  return { valid: true, head: previous, count: events.length };
}

export function createContinuityPacket(input = {}) {
  const packet = {
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    packet_id: String(input.packet_id || '').trim(),
    source_shot_id: String(input.source_shot_id || '').trim(),
    end_frame_asset_id: String(input.end_frame_asset_id || '').trim(),
    state: input.state || {},
    predecessor_fingerprint: input.predecessor_fingerprint || null
  };
  if (!packet.packet_id || !packet.source_shot_id || !packet.end_frame_asset_id) throw new TypeError('packet_id, source_shot_id, and end_frame_asset_id are required.');
  return Object.freeze({ ...packet, fingerprint: makevideoFingerprint('continuity-packet', packet), authority_granted: false });
}

export function createLease(input = {}) {
  const lease = {
    protocol_version: MAKEVIDEO_PROTOCOL_VERSION,
    lease_id: String(input.lease_id || '').trim(),
    job_attempt_id: String(input.job_attempt_id || '').trim(),
    worker_id: String(input.worker_id || '').trim(),
    acquired_at: normalizeString(input.acquired_at || new Date().toISOString()),
    expires_at: normalizeString(input.expires_at || ''),
    heartbeat_at: normalizeString(input.heartbeat_at || input.acquired_at || new Date().toISOString())
  };
  if (!lease.lease_id || !lease.job_attempt_id || !lease.worker_id || !lease.expires_at) throw new TypeError('lease_id, job_attempt_id, worker_id, and expires_at are required.');
  return Object.freeze({ ...lease, fingerprint: makevideoFingerprint('lease', lease), authority_granted: false });
}

export function claimMayBeUsedAsProof(classification) {
  return new Set(['VERIFIED', 'DEMONSTRATED', 'DOCUMENTED']).has(String(classification || '').toUpperCase());
}
