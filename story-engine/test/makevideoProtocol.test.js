import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAKEVIDEO_PROTOCOL_VERSION,
  canonicalJson,
  claimMayBeUsedAsProof,
  createContinuityPacket,
  createJobSpec,
  createReceiptEvent,
  createShotObjective,
  createStateEvent,
  isLegalTransition,
  makevideoFingerprint,
  verifyReceiptEventChain
} from '../lib/makevideoProtocol.js';

test('canonical serialization is stable across key order and unicode equivalents', () => {
  const a = { z: 2, label: 'Cafe\u0301', nested: { b: 2, a: 1 } };
  const b = { nested: { a: 1, b: 2 }, label: 'Café', z: 2 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(makevideoFingerprint('fixture', a), makevideoFingerprint('fixture', b));
});

test('job fingerprint excludes transient provider state but changes for a creative repair', () => {
  const base = {
    objective_id: 'OBJ_S004_SH003',
    job_kind: 'VIDEO_RENDER',
    immutable_job_spec: { prompt: 'walk to desk', provider_job_id: 'transient-a', polling_status: 'queued' },
    canon_versions: { creative: 'CC_V7', evidence: 'EC_V4', release: 'RC_V3' },
    adapter_id: 'open-weight-video',
    adapter_version: 'comfyui@1.2.0',
    bounded_input_hashes: ['a'.repeat(64)],
    expected_outputs: ['CLIP', 'FIRST_FRAME', 'LAST_FRAME'],
    cost_ceiling: { currency: 'USD', amount: 1.5 }
  };
  const first = createJobSpec(base);
  const sameSemanticJob = createJobSpec({
    ...base,
    immutable_job_spec: { ...base.immutable_job_spec, provider_job_id: 'transient-b', polling_status: 'running' }
  });
  const repair = createJobSpec({ ...base, repair_spec: { reason: 'IDENTITY_DRIFT', action: 'restore locked reference' }, retry_ordinal: 1 });
  assert.equal(first.protocol_version, MAKEVIDEO_PROTOCOL_VERSION);
  assert.equal(first.idempotency_key, sameSemanticJob.idempotency_key);
  assert.notEqual(first.idempotency_key, repair.idempotency_key);
  assert.equal(first.authority_granted, false);
});

test('shot objective and job attempt state machines remain independent', () => {
  const objective = createShotObjective({
    objective_id: 'OBJ_S004_SH003',
    video_id: 'VID_FOUNDER_001',
    scene_id: 'S004',
    shot_id: 'S004_SH003',
    requirement: 'Founder looks up and walks toward the desk.',
    truth_class: 'DRAMATIZED'
  });
  assert.equal(objective.status, 'OPEN');
  assert.equal(isLegalTransition('job_attempt', 'REVIEW_PENDING', 'REJECTED'), true);
  assert.equal(isLegalTransition('shot_objective', 'OPEN', 'SATISFIED'), true);
  assert.equal(isLegalTransition('shot_objective', 'OPEN', 'REJECTED'), false);
});

test('release publication needs its own publish path', () => {
  assert.equal(isLegalTransition('release', 'VERIFIED', 'PUBLISHED'), false);
  assert.equal(isLegalTransition('release', 'VERIFIED', 'PUBLISH_APPROVED'), true);
  assert.equal(isLegalTransition('release', 'PUBLISH_APPROVED', 'PUBLISHING'), true);
  assert.equal(isLegalTransition('release', 'PUBLISHING', 'PUBLISHED'), true);
});

test('receipt events form an immutable tamper-evident chain', () => {
  const submitted = createReceiptEvent({
    receipt_id: 'RCP_SH003_A1',
    sequence: 1,
    type: 'SUBMITTED',
    at: '2026-09-20T22:10:14Z',
    payload: { provider_job_id: 'provider-123', request_hash: 'sha256:' + 'b'.repeat(64) }
  });
  const completed = createReceiptEvent({
    receipt_id: 'RCP_SH003_A1',
    sequence: 2,
    type: 'PROVIDER_COMPLETED',
    at: '2026-09-20T22:11:03Z',
    previous_event_hash: submitted.event_hash,
    payload: { provider_status: 'SUCCEEDED' }
  });
  assert.equal(verifyReceiptEventChain([submitted, completed]).valid, true);
  const tampered = { ...completed, payload: { provider_status: 'FAILED' } };
  assert.equal(verifyReceiptEventChain([submitted, tampered]).reason, 'payload_fingerprint_mismatch');
});

test('state events reject illegal cross-scope transitions', () => {
  const event = createStateEvent({
    scope: 'shot_objective',
    subject_id: 'OBJ_S004_SH003',
    from: 'OPEN',
    to: 'SATISFIED',
    at: '2026-09-20T22:15:00Z',
    evidence_refs: ['RCP_SH003_A3']
  });
  assert.match(event.event_hash, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => createStateEvent({ scope: 'release', subject_id: 'REL_1', from: 'VERIFIED', to: 'PUBLISHED' }), /Illegal release transition/);
});

test('continuity packet carries an explicit fingerprint and never grants authority', () => {
  const packet = createContinuityPacket({
    packet_id: 'CP_S004_SH003_END_V1',
    source_shot_id: 'S004_SH003',
    end_frame_asset_id: 'AST_FRAME_END_884',
    state: { character: { position: 'right third', wardrobe: 'black jacket' }, camera_axis: 'A' }
  });
  assert.match(packet.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(packet.authority_granted, false);
});

test('claim taxonomy never treats illustrative, dramatized, simulated, inferred, or unknown as proof', () => {
  assert.equal(claimMayBeUsedAsProof('VERIFIED'), true);
  assert.equal(claimMayBeUsedAsProof('DEMONSTRATED'), true);
  assert.equal(claimMayBeUsedAsProof('DOCUMENTED'), true);
  for (const value of ['ILLUSTRATIVE', 'DRAMATIZED', 'SIMULATED', 'INFERRED', 'UNKNOWN', 'TESTIMONIAL']) {
    assert.equal(claimMayBeUsedAsProof(value), false);
  }
});
