import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComfyWorkflow } from '../lib/openVideoRenderer.js';
import { syncAvenueRendererDirection } from '../lib/syncAvenueRendererBridge.js';

function fixtureJob() {
  const founderIntent = {
    content: 'Make every visible response answer to the same grounded cause.',
    intent_semantics_fingerprint: `sha256:${'c'.repeat(64)}`
  };
  const shot = {
    shot_id: 'shot_01',
    duration_seconds: 5,
    provider_prompt: 'A subject crosses the room.',
    negative_constraints: ['identity drift'],
    sync_avenue: {
      world_state_fingerprint: `sha256:${'d'.repeat(64)}`,
      bindings: [
        {
          signal_id: 'shared_force',
          signal_kind: 'environmental_force',
          entity_id: 'surface_a',
          entity_kind: 'responsive_material',
          channel_semantic: 'deformation',
          synchronization_group: 'cause:shared_force'
        },
        {
          signal_id: 'shared_force',
          signal_kind: 'environmental_force',
          entity_id: 'surface_b',
          entity_kind: 'responsive_material',
          channel_semantic: 'deformation',
          synchronization_group: 'cause:shared_force'
        }
      ]
    }
  };
  const bridge = syncAvenueRendererDirection(shot, founderIntent);
  shot.provider_prompt = `${shot.provider_prompt}\n\n${bridge.direction}`;
  shot.sync_avenue.renderer_bridge = bridge;
  return {
    founderIntent,
    shot,
    job: {
      job_id: 'video_job_sync_avenue',
      workspace_id: 'workspace-sync-avenue',
      source_revision_id: 'revision-sync-avenue',
      blueprint: {
        aspect_ratio: '16:9',
        target_mode: 'cinematic_3d',
        visual_style: 'cinematic_realism',
        character_bible: [],
        world_bible: { source: 'fixture' },
        sync_avenue: {
          founder_intent: founderIntent,
          world_state_fingerprint: shot.sync_avenue.world_state_fingerprint
        },
        shots: [shot]
      }
    }
  };
}

test('renderer direction carries founder intent and grouped causality without granting authority', () => {
  const { founderIntent, shot } = fixtureJob();
  const bridge = syncAvenueRendererDirection(shot, founderIntent);

  assert.equal(bridge.authority_granted, false);
  assert.equal(bridge.causal_group_count, 1);
  assert.equal(bridge.causal_binding_count, 2);
  assert.match(bridge.direction, /SYNC AVENUE REALITY CONTRACT/);
  assert.match(bridge.direction, /Founder intent: Make every visible response answer to the same grounded cause\./);
  assert.match(bridge.direction, /cause:shared_force/);
  assert.match(bridge.direction, /surface_a\.deformation/);
  assert.match(bridge.direction, /surface_b\.deformation/);
  assert.match(bridge.direction, /Do not infer physics from object names/);
  assert.ok(bridge.fingerprint.startsWith('sha256:'));
});

test('existing self-hosted renderer consumes the Sync Avenue reality contract as its actual prompt', () => {
  const { job, shot } = fixtureJob();
  const workflow = {
    prompt: '__LEEVIZE_PROMPT__',
    negative: '__LEEVIZE_NEGATIVE_PROMPT__',
    seed: '__LEEVIZE_SEED__',
    width: '__LEEVIZE_WIDTH__',
    height: '__LEEVIZE_HEIGHT__',
    frames: '__LEEVIZE_FRAMES__',
    fps: '__LEEVIZE_FPS__',
    model: '__LEEVIZE_MODEL__',
    encoder: '__LEEVIZE_TEXT_ENCODER__',
    vae: '__LEEVIZE_VAE__',
    image: '__LEEVIZE_INPUT_IMAGE__',
    cookie: '__LEEVIZE_CONTINUITY_COOKIE__'
  };

  const compiled = compileComfyWorkflow(workflow, shot, job, 0, { input_image_name: 'reality-reference.png' });
  assert.equal(compiled.prompt, shot.provider_prompt);
  assert.match(compiled.prompt, /SYNC AVENUE REALITY CONTRACT/);
  assert.match(compiled.prompt, /cause:shared_force/);
  assert.match(compiled.prompt, /Founder intent:/);
  assert.equal(compiled.image, 'reality-reference.png');
  assert.equal(compiled.negative, 'identity drift');
});
