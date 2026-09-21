import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReceiptContinuity,
  createContinuityCookie,
  createProofCookie,
  verifyContinuityCookie
} from '../lib/videoContinuity.js';

function job(overrides = {}) {
  return {
    job_id: 'video_job_fingerprint_test',
    workspace_id: 'workspace-a',
    source_revision_id: 'source-revision-a',
    blueprint: {
      target_mode: 'live_action',
      visual_style: 'cinematic_realism',
      aspect_ratio: '9:16',
      character_bible: [{ character_id: 'lead', name: 'Lead', locked_visuals: ['black jacket'] }],
      world_bible: { palette: 'rain + amber practicals' },
      shots: [{
        shot_id: 'shot_01',
        duration_seconds: 8,
        shot_command: '/dolly-in Lead',
        provider_prompt: 'Lead walks toward the desk.',
        must_preserve: ['same face', 'same jacket'],
        negative_constraints: ['identity drift'],
        shot_direction: { opening_frame: 'phone at chest height', ending_frame: 'one step toward desk' }
      }],
      ...overrides.blueprint
    },
    ...overrides
  };
}

test('continuity cookie carries source, canon and shot fingerprints without authority', () => {
  const cookie = createContinuityCookie(job());
  assert.match(cookie.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(cookie.fingerprints.source_revision, /^sha256:[0-9a-f]{64}$/);
  assert.match(cookie.fingerprints.creative_canon, /^sha256:[0-9a-f]{64}$/);
  assert.match(cookie.fingerprints.shot_plan, /^sha256:[0-9a-f]{64}$/);
  assert.equal(cookie.browser_cookie, false);
  assert.equal(cookie.action_authority, false);
  assert.equal(cookie.publish_authority, false);
  assert.equal(cookie.credentials_embedded, false);
  assert.equal(verifyContinuityCookie(job(), cookie).matches, true);
});

test('proof cookie binds output fingerprint to the exact continuity fingerprint', () => {
  const current = job();
  const continuity = createContinuityCookie(current);
  const proof = createProofCookie(current, {
    evidence_class: 'rendered_open_weight_video',
    output_sha256: 'a'.repeat(64),
    renderer: 'comfyui_open_weight_video_v1',
    workflow_sha256: 'b'.repeat(64),
    media_probe: { verified: true, duration_seconds: 8 }
  });
  assert.equal(proof.continuity_fingerprint, continuity.fingerprint);
  assert.equal(proof.output_fingerprint, `sha256:${'a'.repeat(64)}`);
  assert.match(proof.evidence_fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(proof.browser_cookie, false);
  assert.equal(proof.action_authority, false);
  assert.equal(proof.publish_authority, false);
});

test('fingerprint mismatch invalidates old green while legacy compact cookies still classify', () => {
  const current = job();
  const cookie = createContinuityCookie(current);
  const legacy = classifyReceiptContinuity(current, { continuity_cookie: cookie.value });
  assert.equal(legacy.receipt_status, 'CURRENT');

  const revised = job({ source_revision_id: 'source-revision-b' });
  const stale = classifyReceiptContinuity(revised, {
    continuity_cookie: cookie.value,
    continuity_fingerprint: cookie.fingerprint
  });
  assert.equal(stale.receipt_status, 'STALE');
  assert.equal(stale.invalidates_old_green, true);
  assert.equal(stale.authority_granted, false);
});
