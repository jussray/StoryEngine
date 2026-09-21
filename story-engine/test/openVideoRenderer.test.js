import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComfyWorkflow, probeOpenVideoRenderer } from '../lib/openVideoRenderer.js';
import { createContinuityCookie } from '../lib/videoContinuity.js';

function fixtureJob() {
  return {
    job_id: 'video_job_test',
    workspace_id: 'workspace-a',
    source_revision_id: 'revision-a',
    blueprint: {
      aspect_ratio: '16:9',
      target_mode: 'live_action',
      visual_style: 'cinematic_realism',
      character_bible: [{ name: 'Lead' }],
      world_bible: { palette: 'rain + amber practicals' },
      shots: [{
        shot_id: 'shot_01',
        duration_seconds: 10,
        provider_prompt: 'Lead walks toward the doorway in the rain.',
        negative_constraints: ['identity drift', 'wardrobe drift'],
        shot_command: '/dolly-in Lead',
        must_preserve: ['same Lead'],
        shot_direction: { opening_frame: 'awning', ending_frame: 'doorway' }
      }]
    }
  };
}

function captureEnv(names) {
  return Object.fromEntries(names.map(name => [name, process.env[name]]));
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('ComfyUI workflow compilation binds canon, model files, reference image and continuity cookie', () => {
  const job = fixtureJob();
  const shot = job.blueprint.shots[0];
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
    cookie: '__LEEVIZE_CONTINUITY_COOKIE__',
    nested: { label: 'shot=__LEEVIZE_SHOT_ID__' }
  };
  const compiled = compileComfyWorkflow(workflow, shot, job, 0, { input_image_name: 'canon.png' });
  assert.equal(compiled.prompt, shot.provider_prompt);
  assert.equal(compiled.negative, 'identity drift, wardrobe drift');
  assert.equal(compiled.width, 832);
  assert.equal(compiled.height, 480);
  assert.equal(compiled.frames, 241);
  assert.equal(compiled.fps, 24);
  assert.equal(compiled.model, 'wan2.2_ti2v_5B_fp16.safetensors');
  assert.equal(compiled.encoder, 'umt5_xxl_fp8_e4m3fn_scaled.safetensors');
  assert.equal(compiled.vae, 'wan2.2_vae.safetensors');
  assert.equal(compiled.image, 'canon.png');
  assert.equal(compiled.cookie, createContinuityCookie(job).value);
  assert.equal(compiled.nested.label, 'shot=shot_01');
  assert.equal(Number.isInteger(compiled.seed), true);
});

test('renderer status never treats missing compute as a vendor-credit blocker', async () => {
  const names = [
    'LEEVIZE_COMFYUI_URL',
    'COMFYUI_URL',
    'LEEVIZE_COMFYUI_WORKFLOW_PATH',
    'LEEVIZE_MODEL_LICENSE_STATUS',
    'LEEVIZE_RENDER_WORKER_ID'
  ];
  const previous = captureEnv(names);
  delete process.env.LEEVIZE_COMFYUI_URL;
  delete process.env.COMFYUI_URL;
  delete process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH;
  process.env.LEEVIZE_MODEL_LICENSE_STATUS = 'verified-commercial';
  process.env.LEEVIZE_RENDER_WORKER_ID = 'test-worker';
  try {
    const status = await probeOpenVideoRenderer();
    assert.equal(status.primary_lane, 'self_hosted_open_weight');
    assert.equal(status.vendor_credit_required, false);
    assert.equal(status.paid_fallback_authoritative, false);
    assert.equal(status.authority, 'none');
    assert.equal(status.ready, false);
    assert.ok(status.blockers.some(item => item.code === 'OPEN_RENDER_COMPUTE_UNCONFIGURED'));
    assert.equal(status.model.id, 'wan2.2-ti2v-5b');
    assert.equal(status.model.license, 'Apache-2.0');
    assert.equal(status.model.commercial_use_allowed, true);
  } finally {
    restoreEnv(previous);
  }
});

test('renderer fails closed when commercial license approval is not explicit', async () => {
  const names = [
    'LEEVIZE_COMFYUI_URL',
    'COMFYUI_URL',
    'LEEVIZE_MODEL_LICENSE_STATUS',
    'LEEVIZE_RENDER_WORKER_ID'
  ];
  const previous = captureEnv(names);
  delete process.env.LEEVIZE_COMFYUI_URL;
  delete process.env.COMFYUI_URL;
  delete process.env.LEEVIZE_MODEL_LICENSE_STATUS;
  process.env.LEEVIZE_RENDER_WORKER_ID = 'test-worker';
  try {
    const status = await probeOpenVideoRenderer();
    assert.equal(status.ready, false);
    assert.ok(status.blockers.some(item => item.code === 'BLOCKED_LICENSE_REVIEW'));
  } finally {
    restoreEnv(previous);
  }
});

test('renderer fails closed when worker identity is missing even if a compute URL is configured', async () => {
  const names = [
    'LEEVIZE_COMFYUI_URL',
    'COMFYUI_URL',
    'LEEVIZE_MODEL_LICENSE_STATUS',
    'LEEVIZE_RENDER_WORKER_ID'
  ];
  const previous = captureEnv(names);
  process.env.LEEVIZE_COMFYUI_URL = 'https://example.invalid';
  delete process.env.COMFYUI_URL;
  process.env.LEEVIZE_MODEL_LICENSE_STATUS = 'verified-commercial';
  delete process.env.LEEVIZE_RENDER_WORKER_ID;
  try {
    const status = await probeOpenVideoRenderer();
    assert.equal(status.ready, false);
    assert.equal(status.configured, false);
    assert.ok(status.blockers.some(item => item.code === 'OPEN_RENDER_COMPUTE_UNCONFIGURED'));
  } finally {
    restoreEnv(previous);
  }
});
