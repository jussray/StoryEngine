import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  acquireRenderLease,
  beginRenderAttempt,
  getRenderAttemptLedger,
  observeRender,
  recordRenderAttemptFailure,
  recordRenderReview,
  recordRenderSubmission,
  releaseRenderLease
} from '../lib/videoRenderLedger.js';

function job() {
  return {
    job_id: 'video_job_ledger',
    workspace_id: 'workspace-ledger',
    source_revision_id: 'source-ledger-v1',
    blueprint: {
      target_mode: 'live_action',
      visual_style: 'cinematic_realism',
      aspect_ratio: '16:9',
      character_bible: [{ character_id: 'lead', locked_visuals: ['black jacket'] }],
      world_bible: { palette: 'rain + amber' },
      shots: [{
        shot_id: 'shot_01',
        duration_seconds: 8,
        provider_prompt: 'Lead walks toward the desk.',
        negative_constraints: ['identity drift'],
        must_preserve: ['same Lead'],
        shot_command: '/dolly-in Lead',
        shot_direction: { opening_frame: 'doorway', ending_frame: 'desk' }
      }]
    }
  };
}

function submittedRender() {
  return {
    render_id: 'open_render_ledger_1',
    job_id: 'video_job_ledger',
    workspace_id: 'workspace-ledger',
    shot_id: 'shot_01',
    continuity_cookie: 'lvz_cc_fixture',
    status: 'submitted',
    renderer: 'comfyui_wan22_ti2v_5b_v2',
    prompt_id: 'prompt-123',
    workflow_sha256: 'b'.repeat(64),
    reference_sha256: 'c'.repeat(64),
    technical_status: 'pending',
    continuity_status: 'pending',
    editorial_status: 'pending',
    authority_granted: false
  };
}

test('render attempt ledger chains receipts, leases and zero-vendor-credit budget reconciliation', () => {
  const db = new DatabaseSync(':memory:');
  const attempt = beginRenderAttempt(db, {
    job: job(),
    shot_id: 'shot_01',
    input: { cost_ceiling_micros: 250_000, attempt: 0 }
  });
  let ledger = getRenderAttemptLedger(db, attempt.attempt_id);
  assert.equal(ledger.receipt_chain.valid, true);
  assert.deepEqual(ledger.receipt_events.map(event => event.type), ['READY', 'BUDGET_RESERVED']);
  assert.equal(ledger.budget.reserved_micros, 250_000);
  assert.equal(ledger.budget.status, 'reserved');
  assert.equal(ledger.authority_granted, false);

  const submitted = submittedRender();
  recordRenderSubmission(db, attempt.attempt_id, submitted);

  const lease1 = acquireRenderLease(db, submitted, { worker_id: 'worker-a', ttl_ms: 30_000 });
  assert.equal(lease1.acquired, true);
  const lease2 = acquireRenderLease(db, submitted, { worker_id: 'worker-b', ttl_ms: 30_000 });
  assert.equal(lease2.acquired, false);
  assert.equal(releaseRenderLease(db, submitted.render_id, lease1.lease.lease_id).released, true);
  const lease3 = acquireRenderLease(db, submitted, { worker_id: 'worker-b', ttl_ms: 30_000 });
  assert.equal(lease3.acquired, true);
  assert.equal(releaseRenderLease(db, submitted.render_id, lease3.lease.lease_id).released, true);

  const complete = {
    ...submitted,
    status: 'complete',
    proof_cookie: 'lvz_pc_fixture',
    output_sha256: 'a'.repeat(64),
    media_url: '/api/video-engine/open-renders/open_render_ledger_1/media',
    technical_status: 'passed',
    continuity_status: 'pending',
    editorial_status: 'pending'
  };
  observeRender(db, complete);
  const reviewed = { ...complete, continuity_status: 'approved', editorial_status: 'approved', review_notes: 'continuity locked' };
  recordRenderReview(db, reviewed);

  ledger = getRenderAttemptLedger(db, attempt.attempt_id);
  assert.equal(ledger.receipt_chain.valid, true);
  assert.ok(ledger.receipt_events.some(event => event.type === 'SUBMITTED'));
  assert.ok(ledger.receipt_events.some(event => event.type === 'PROVIDER_COMPLETED'));
  assert.ok(ledger.receipt_events.some(event => event.type === 'ASSET_PERSISTED'));
  assert.ok(ledger.receipt_events.some(event => event.type === 'QA_RECORDED'));
  assert.ok(ledger.receipt_events.some(event => event.type === 'REVIEW_RECORDED'));
  assert.ok(ledger.receipt_events.some(event => event.type === 'BUDGET_COMMITTED'));
  assert.ok(ledger.receipt_events.some(event => event.type === 'BUDGET_RELEASED'));
  assert.equal(ledger.budget.committed_micros, 0);
  assert.equal(ledger.budget.released_micros, 250_000);
  assert.equal(ledger.budget.status, 'closed');
  assert.equal(ledger.lease_chain.valid, true);
  assert.equal(ledger.lease_chain.count, 4);
  assert.equal(ledger.attempt.status, 'APPROVED');

  assert.throws(
    () => db.prepare("UPDATE story_video_render_receipt_events SET event_type='FAKE_GREEN' WHERE receipt_id=?").run(attempt.receipt_id),
    /immutable/
  );
  assert.throws(
    () => db.prepare('DELETE FROM story_video_render_lease_events WHERE subject_id=?').run(submitted.render_id),
    /immutable/
  );
  db.close();
});

test('failed render attempt preserves its own receipt and releases only its reservation', () => {
  const db = new DatabaseSync(':memory:');
  const first = beginRenderAttempt(db, { job: job(), shot_id: 'shot_01', input: { cost_ceiling_micros: 90_000 } });
  const second = beginRenderAttempt(db, { job: job(), shot_id: 'shot_01', input: { cost_ceiling_micros: 40_000, attempt: 1 } });
  recordRenderAttemptFailure(db, first.attempt_id, Object.assign(new Error('GPU unavailable'), { code: 'OPEN_RENDER_COMPUTE_UNREACHABLE' }));

  const failed = getRenderAttemptLedger(db, first.attempt_id);
  const untouched = getRenderAttemptLedger(db, second.attempt_id);
  assert.equal(failed.receipt_chain.valid, true);
  assert.equal(failed.attempt.status, 'FAILED');
  assert.equal(failed.budget.released_micros, 90_000);
  assert.equal(failed.budget.status, 'closed');
  assert.equal(untouched.budget.reserved_micros, 40_000);
  assert.equal(untouched.budget.released_micros, 0);
  assert.equal(untouched.budget.status, 'reserved');
  assert.equal(untouched.receipt_chain.valid, true);
  db.close();
});
