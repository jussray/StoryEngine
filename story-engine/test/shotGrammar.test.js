import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

test('compiler expands terse direction into cinematic production fields without selecting a provider', () => {
  const direction = compileShotDirection({
    command: '/dollyin Mina',
    action: 'Mina sees the violet door and stops.',
    emotion: 'wonder',
    duration_seconds: 6,
    style_prompt: 'cinematic realism with storm light',
    must_preserve: ['Mina keeps her yellow raincoat and silver glasses.'],
    negative_constraints: ['no identity drift']
  });

  assert.equal(direction.provider_neutral, true);
  assert.equal(direction.command_name, 'dolly_in');
  assert.equal(direction.camera_move, 'dolly_in');
  assert.equal(direction.preview_camera_move, 'push_in');
  assert.equal(direction.shot_type, 'medium');
  assert.match(direction.lens, /50mm/);
  assert.match(direction.provider_prompt, /SHOT COMMAND: \/dollyin Mina/);
  assert.match(direction.provider_prompt, /CONTINUITY:/);
  assert.match(direction.provider_prompt, /no identity drift/);
  assert.doesNotMatch(direction.provider_prompt, /OpenAI|Google|Runway|Kling|Veo|Sora/i);
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
