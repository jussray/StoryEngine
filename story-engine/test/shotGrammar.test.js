import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPEN_SOURCE_VIDEO_POLICY,
  SHOT_COMMANDS,
  compileShotDirection,
  parseShotCommand,
  shotCommandFor
} from '../lib/shotGrammar.js';

test('shot command aliases normalize into one provider-neutral grammar', () => {
  assert.equal(parseShotCommand('/dollyin Mina').command, 'dolly_in');
  assert.equal(parseShotCommand('/dolly-in Mina').command, 'dolly_in');
  assert.equal(parseShotCommand('/whippan door').command, 'whip_pan');
  assert.equal(parseShotCommand('/hyperlaps city').command, 'hyperlapse');

  const rack = parseShotCommand('/rackfocus Mina -> violet door');
  assert.equal(rack.command, 'rack_focus');
  assert.equal(rack.subject, 'Mina');
  assert.equal(rack.target, 'violet door');
  assert.throws(() => parseShotCommand('/deploy prod'), /Unsupported shot command/);
});

test('compiler expands terse direction into Shot DNA plus Video Creation OS without selecting a provider', () => {
  const direction = compileShotDirection({
    command: '/dollyin Mina',
    action: 'Mina sees the violet door and stops.',
    emotion: 'wonder',
    duration_seconds: 6,
    style_prompt: 'cinematic realism with storm light',
    must_preserve: ['Mina keeps her yellow raincoat and silver glasses.'],
    negative_constraints: ['no identity drift'],
    video_os: {
      selections: {
        angle: '/shoulder',
        composition: '/thirdgrid',
        focus: '/isolatefocus',
        color: '/coalteal',
        lighting: '/rimlight'
      },
      output_intent: 'clear emotional reveal with readable continuity'
    }
  });

  assert.equal(direction.schema_version, '1.2.0');
  assert.equal(direction.shot_contract, 'shot-dna@v1');
  assert.equal(direction.provider_neutral, true);
  assert.equal(direction.command_name, 'dolly_in');
  assert.equal(direction.camera_move, 'dolly_in');
  assert.equal(direction.preview_camera_move, 'push_in');
  assert.equal(direction.shot_type, 'medium');
  assert.match(direction.lens, /50mm/);
  assert.match(direction.story_job, /Mina sees the violet door and stops/);
  assert.match(direction.opening_frame, /Mina/);
  assert.match(direction.ending_frame, /next shot/);
  assert.match(direction.environmental_motion, /motivated environmental motion/i);
  assert.match(direction.soundscape, /ambience and Foley/i);
  assert.deepEqual(direction.continuity_constraints, ['Mina keeps her yellow raincoat and silver glasses.']);
  assert.equal(direction.video_creation_os.contract, 'l99/video-creation-os@v1');
  assert.equal(direction.video_creation_os.workflow, 'LEEVIZE');
  assert.deepEqual(direction.video_creation_os.authority, {
    plan: true,
    render: false,
    spend: false,
    publish: false,
    truth_reclassification: false
  });
  assert.deepEqual(direction.video_creation_os.selections.map(item => item.command), [
    '/shoulder', '/thirdgrid', '/isolatefocus', '/coalteal', '/rimlight'
  ]);
  assert.match(direction.provider_prompt, /SHOT COMMAND: \/dollyin Mina/);
  assert.match(direction.provider_prompt, /STORY JOB:/);
  assert.match(direction.provider_prompt, /OPENING FRAME:/);
  assert.match(direction.provider_prompt, /ENDING FRAME:/);
  assert.match(direction.provider_prompt, /VIDEO CREATION OS:/);
  assert.match(direction.provider_prompt, /\/shoulder/);
  assert.match(direction.provider_prompt, /\/thirdgrid/);
  assert.match(direction.provider_prompt, /CONTINUITY:/);
  assert.match(direction.provider_prompt, /no identity drift/);
  assert.doesNotMatch(direction.provider_prompt, /OpenAI|Google|Runway|Kling|Veo|Sora/i);
});

test('open-source policy keeps deterministic post, creator OS, and renderer choice replaceable', () => {
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.workflow, 'LEEVIZE');
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.video_creation_os_contract, 'l99/video-creation-os@v1');
  assert.deepEqual(OPEN_SOURCE_VIDEO_POLICY.compile_order, ['director-brief', 'video-creation-os', 'model-neutral-shot-spec', 'renderer-adapter']);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.open_source_first, true);
  assert.deepEqual(OPEN_SOURCE_VIDEO_POLICY.deterministic_post_tools, ['ffmpeg', 'ffprobe']);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.candidate_availability_is_runtime_fact, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.license_must_be_verified_before_production, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.unknown_license_is_blocked, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.renderer_adapters_replaceable, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.generated_ui_may_prove_product_behavior, false);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.real_product_capture_requires_playwright, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.final_audio_precedes_caption_timing, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.creative_commands_do_not_grant_render_spend_publish_or_truth_authority, true);
});

test('default director uses restrained story coverage while richer commands remain available', () => {
  const characters = ['Mina', 'Bip'];
  assert.equal(shotCommandFor(0, { characters }), '/establish');
  assert.equal(shotCommandFor(1, { characters }), '/dolly-in Mina');
  assert.equal(shotCommandFor(2, { characters }), '/rack-focus Mina -> Bip');
  assert.equal(shotCommandFor(3, { characters }), '/reaction Mina');
  assert.ok(SHOT_COMMANDS.whip_pan);
  assert.ok(SHOT_COMMANDS.hyperlapse);
});
