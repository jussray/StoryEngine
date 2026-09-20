import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIDEO_CONTINUITY_COOKIE_CONTRACT,
  VIDEO_PROOF_COOKIE_CONTRACT,
  classifyReceiptContinuity,
  createContinuityCookie,
  createProofCookie,
  verifyContinuityCookie
} from '../lib/videoContinuity.js';

function job(overrides = {}) {
  return {
    job_id: 'video_job_test',
    workspace_id: 'workspace-a',
    source_revision_id: 'source-revision-a',
    blueprint: {
      target_mode: 'live_action',
      visual_style: 'cinematic_realism',
      aspect_ratio: '16:9',
      character_bible: [{ character_id: 'lead', name: 'Lead', locked_visuals: ['dark raincoat'] }],
      world_bible: { palette: 'cool rain + amber practicals' },
      shots: [{
        shot_id: 'shot_01',
        duration_seconds: 10,
        shot_command: '/dolly-in Lead',
        provider_prompt: 'Lead walks through rain.',
        must_preserve: ['same face', 'same coat'],
        negative_constraints: ['identity drift'],
        shot_direction: { opening_frame: 'under awning', ending_frame: 'at doorway' }
      }],
      ...overrides.blueprint
    },
    ...overrides
  };
}

test('continuity cookie is deterministic, non-secret and non-authorizing', () => {
  const first = createContinuityCookie(job());
  const second = createContinuityCookie(job());
  assert.equal(first.contract, VIDEO_CONTINUITY_COOKIE_CONTRACT);
  assert.equal(first.value, second.value);
  assert.match(first.value, /^lvz_cc_[0-9a-f]{24}$/);
  assert.equal(first.secret, false);
  assert.equal(first.authority, 'none');
  assert.equal(verifyContinuityCookie(job(), first).matches, true);
  assert.equal(verifyContinuityCookie(job(), first).authority_granted, false);
});

test('editing canon or a shot invalidates the prior continuity cookie', () => {
  const original = job();
  const cookie = createContinuityCookie(original);
  const edited = job({ blueprint: {
    ...original.blueprint,
    shots: [{ ...original.blueprint.shots[0], shot_command: '/reaction Lead' }]
  }});
  const result = verifyContinuityCookie(edited, cookie.value);
  assert.equal(result.matches, false);
  assert.equal(result.stale, true);
  assert.equal(result.authority_granted, false);
});

test('proof cookie binds output evidence to the current continuity cookie without granting authority', () => {
  const current = job();
  const continuity = createContinuityCookie(current);
  const proof = createProofCookie(current, {
    evidence_class: 'rendered_open_weight_video',
    output_sha256: 'a'.repeat(64),
    renderer: 'comfyui_open_weight_video_v1',
    workflow_sha256: 'b'.repeat(64),
    media_probe: { verified: true, duration_seconds: 10 }
  });
  assert.equal(proof.contract, VIDEO_PROOF_COOKIE_CONTRACT);
  assert.equal(proof.continuity_cookie, continuity.value);
  assert.match(proof.value, /^lvz_pc_[0-9a-f]{24}$/);
  assert.equal(proof.authority, 'none');

  const state = classifyReceiptContinuity(current, { continuity_cookie: continuity.value });
  assert.equal(state.receipt_status, 'CURRENT');
  assert.equal(state.invalidates_old_green, false);
});

test('new evidence marks an old receipt stale instead of preserving false green state', () => {
  const original = job();
  const oldCookie = createContinuityCookie(original).value;
  const revised = job({ source_revision_id: 'source-revision-b' });
  const state = classifyReceiptContinuity(revised, { continuity_cookie: oldCookie });
  assert.equal(state.receipt_status, 'STALE');
  assert.equal(state.invalidates_old_green, true);
  assert.equal(state.authority_granted, false);
});
