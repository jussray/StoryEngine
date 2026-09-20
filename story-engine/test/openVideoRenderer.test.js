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
  const previous = {
    url: process.env.LEEVIZE_COMFYUI_URL,
    alt: process.env.COMFYUI_URL,
    workflow: process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH
  };
  delete process.env.LEEVIZE_COMFYUI_URL;
  delete process.env.COMFYUI_URL;
  delete process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH;
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
    if (previous.url === undefined) delete process.env.LEEVIZE_COMFYUI_URL; else process.env.LEEVIZE_COMFYUI_URL = previous.url;
    if (previous.alt === undefined) delete process.env.COMFYUI_URL; else process.env.COMFYUI_URL = previous.alt;
    if (previous.workflow === undefined) delete process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH; else process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH = previous.workflow;
  }
});
