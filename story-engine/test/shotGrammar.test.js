import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPEN_SOURCE_VIDEO_POLICY,
  SHOT_COMMANDS,
  SHOT_CONTINUITY_CONTRACT_FIELDS,
  buildShotContinuityGate,
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

test('compiler expands terse direction into Shot DNA without selecting a provider', () => {
  const direction = compileShotDirection({
    command: '/dollyin Mina',
    action: 'Mina sees the violet door and stops.',
    emotion: 'wonder',
    duration_seconds: 6,
    style_prompt: 'cinematic realism with storm light',
    must_preserve: ['Mina keeps her yellow raincoat and silver glasses.'],
    negative_constraints: ['no identity drift']
  });

  assert.equal(direction.schema_version, '1.1.0');
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
  assert.match(direction.provider_prompt, /SHOT COMMAND: \/dollyin Mina/);
  assert.match(direction.provider_prompt, /STORY JOB:/);
  assert.match(direction.provider_prompt, /OPENING FRAME:/);
  assert.match(direction.provider_prompt, /ENDING FRAME:/);
  assert.match(direction.provider_prompt, /CONTINUITY:/);
  assert.match(direction.provider_prompt, /no identity drift/);
  assert.doesNotMatch(direction.provider_prompt, /OpenAI|Google|Runway|Kling|Veo|Sora/i);
});

test('open-source policy keeps deterministic post and renderer choice replaceable', () => {
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.workflow, 'LEEVIZE');
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.open_source_first, true);
  assert.deepEqual(OPEN_SOURCE_VIDEO_POLICY.deterministic_post_tools, ['ffmpeg', 'ffprobe']);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.candidate_availability_is_runtime_fact, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.license_must_be_verified_before_production, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.unknown_license_is_blocked, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.renderer_adapters_replaceable, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.generated_ui_may_prove_product_behavior, false);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.real_product_capture_requires_playwright, true);
  assert.equal(OPEN_SOURCE_VIDEO_POLICY.final_audio_precedes_caption_timing, true);
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


test('three-shot microsequence has complete pre-render contracts and compatible adjacent anchors', () => {
  const first = compileShotDirection({
    command: '/establish',
    opening_frame: 'Mina stands at the rain-lit curb in her yellow raincoat and silver glasses.',
    ending_frame: 'Mina stops at the violet door with her right hand raised.',
    must_preserve: ['Mina keeps her yellow raincoat and silver glasses.']
  });
  const second = compileShotDirection({
    command: '/dolly-in Mina',
    opening_frame: first.ending_frame,
    ending_frame: 'Mina touches the violet door while the same storm light holds.',
    must_preserve: ['Mina keeps her yellow raincoat and silver glasses.']
  });
  const third = compileShotDirection({
    command: '/close Mina',
    opening_frame: second.ending_frame,
    ending_frame: 'Mina looks through the opened violet door; wardrobe, glasses, and storm light remain unchanged.',
    must_preserve: ['Mina keeps her yellow raincoat and silver glasses.']
  });
  const gate = buildShotContinuityGate([
    { shot_id: 'shot_01', shot_direction: first, must_preserve: first.continuity_constraints, environment_state: 'Same curb, storm, violet door, and lighting logic.' },
    { shot_id: 'shot_02', shot_direction: second, must_preserve: second.continuity_constraints, environment_state: 'Same curb, storm, violet door, and lighting logic.' },
    { shot_id: 'shot_03', shot_direction: third, must_preserve: third.continuity_constraints, environment_state: 'Same curb, storm, violet door, and lighting logic.' }
  ]);

  assert.equal(gate.status, 'TEST');
  assert.equal(gate.ready_for_render, true);
  assert.equal(gate.rendered_frame_receipts_complete, false);
  assert.equal(gate.contracts.length, 3);
  assert.deepEqual(Object.keys(gate.contracts[0]), SHOT_CONTINUITY_CONTRACT_FIELDS);
  assert.equal(gate.contracts[0].EXIT_FRAME_ANCHOR, gate.contracts[1].ENTRY_FRAME_ANCHOR);
  assert.equal(gate.contracts[1].EXIT_FRAME_ANCHOR, gate.contracts[2].ENTRY_FRAME_ANCHOR);
  assert.equal(gate.contracts.every(contract => contract.EVIDENCE_PLANE === 'GENERATED_VISUALIZATION'), true);
});
