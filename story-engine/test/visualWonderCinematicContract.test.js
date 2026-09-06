import test from 'node:test';
import assert from 'node:assert/strict';

import { ATTACK_3000_LENSES, resolveMotionBrief } from '../lib/visualWonder.js';

function cinematicMotionBrief(overrides = {}) {
  return {
    level: 5,
    renderer: 'generative',
    intent: 'reveal',
    selection_reason: 'The approved source world must become a causal multi-shot film rather than a moving poster.',
    focal_point: { x: 0.5, y: 0.5 },
    intensity: 0.45,
    duration_seconds: 12,
    fps: 30,
    aspect_ratio: '9:16',
    preserve: { identity: true, clothing: true, environment: true, typography: true },
    reduced_motion_fallback: true,
    cinematic_contract: {
      experience_class: 'cinematic_short',
      approved_source_frame: true,
      source_frame_role: 'visual_fingerprint',
      source_frame_fingerprint: 'sha256:approved-source-frame',
      minimum_distinct_shots: 6,
      requires_causal_progression: true,
      requires_world_state_change: true,
      requires_payoff: true,
      forbids_motion_poster_substitution: true,
      forbidden_overlays: ['cards', 'floating_ui'],
      continuity_cookie: {
        required: true,
        stale_rejected: true,
        reissue_on_state_change: true,
        expires_on: ['source_frame_change', 'subject_change', 'evidence_change', 'authority_change', 'runtime_change']
      },
      attack_3000: {
        enabled: true,
        external_test_count_claimed: false,
        lenses: ATTACK_3000_LENSES
      }
    },
    ...overrides
  };
}

test('approved source-frame cinematic short survives as full generative multi-shot intent', () => {
  const result = resolveMotionBrief({
    aspect_ratio: '9:16',
    visual_wonder: { motion_brief: cinematicMotionBrief() }
  });

  assert.equal(result.level, 5);
  assert.equal(result.renderer, 'generative');
  assert.equal(result.requires_generative_provider, true);
  assert.equal(result.cinematic_contract.experience_class, 'cinematic_short');
  assert.equal(result.cinematic_contract.source_frame_role, 'visual_fingerprint');
  assert.equal(result.cinematic_contract.minimum_distinct_shots, 6);
  assert.equal(result.cinematic_contract.forbids_motion_poster_substitution, true);
  assert.deepEqual(result.cinematic_contract.forbidden_overlays, ['cards', 'floating_ui']);
  assert.deepEqual(result.cinematic_contract.attack_3000.lenses, ATTACK_3000_LENSES);
});

test('motion-poster downgrade hard-fails for approved source-frame cinematic short', () => {
  assert.throws(() => resolveMotionBrief({
    visual_wonder: {
      motion_brief: cinematicMotionBrief({ level: 1, renderer: 'ffmpeg' })
    }
  }), /motion-poster downgrade/);
});

test('approved source frame without immutable fingerprint hard-fails', () => {
  const brief = cinematicMotionBrief();
  brief.cinematic_contract.source_frame_fingerprint = null;
  assert.throws(() => resolveMotionBrief({ visual_wonder: { motion_brief: brief } }), /source_frame_fingerprint/);
});

test('stale continuity cannot masquerade as current cinematic proof', () => {
  const brief = cinematicMotionBrief();
  brief.cinematic_contract.continuity_cookie.stale_rejected = false;
  assert.throws(() => resolveMotionBrief({ visual_wonder: { motion_brief: brief } }), /stale_rejected/);
});

test('Attack 3000 requires Attack Ten, Red Team, Twin, Lindy, OODA, and L99 without claiming 3000 literal tests', () => {
  const brief = cinematicMotionBrief();
  brief.cinematic_contract.attack_3000.lenses = ['attack_ten', 'red_team', 'twin', 'lindy', 'ooda'];
  assert.throws(() => resolveMotionBrief({ visual_wonder: { motion_brief: brief } }), /missing l99/);

  const literalClaim = cinematicMotionBrief();
  literalClaim.cinematic_contract.attack_3000.external_test_count_claimed = true;
  assert.throws(() => resolveMotionBrief({ visual_wonder: { motion_brief: literalClaim } }), /must not claim 3000 literal external tests/);
});

test('ordinary motion-poster work remains cheap and backward compatible', () => {
  const result = resolveMotionBrief({
    visual_wonder: {
      motion_brief: {
        level: 1,
        renderer: 'ffmpeg',
        intent: 'wonder',
        selection_reason: 'A camera push is the intended deliverable.',
        reduced_motion_fallback: true,
        preserve: { identity: true, clothing: true, environment: true, typography: true }
      }
    }
  });
  assert.equal(result.level, 1);
  assert.equal(result.renderer, 'ffmpeg');
  assert.equal(result.cinematic_contract, null);
});
