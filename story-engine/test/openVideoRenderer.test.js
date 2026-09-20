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

test('ComfyUI template compilation binds the same continuity cookie into the render request', () => {
  const job = fixtureJob();
  const shot = job.blueprint.shots[0];
  const workflow = {
    prompt: '__LEEVIZE_PROMPT__',
    negative: '__LEEVIZE_NEGATIVE_PROMPT__',
    seed: '__LEEVIZE_SEED__',
    width: '__LEEVIZE_WIDTH__',
    height: '__LEEVIZE_HEIGHT__',
    frames: '__LEEVIZE_FRAMES__',
    cookie: '__LEEVIZE_CONTINUITY_COOKIE__',
    nested: { label: 'shot=__LEEVIZE_SHOT_ID__' }
  };
  const compiled = compileComfyWorkflow(workflow, shot, job, 0);
  assert.equal(compiled.prompt, shot.provider_prompt);
  assert.equal(compiled.negative, 'identity drift, wardrobe drift');
  assert.equal(compiled.width, 1280);
  assert.equal(compiled.height, 720);
  assert.equal(compiled.frames, 240);
  assert.equal(compiled.cookie, createContinuityCookie(job).value);
  assert.equal(compiled.nested.label, 'shot=shot_01');
  assert.equal(Number.isInteger(compiled.seed), true);
});

test('renderer status never treats missing compute as a vendor-credit blocker', async () => {
  const previous = {
    url: process.env.LEEVIZE_COMFYUI_URL,
    workflow: process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH,
    license: process.env.LEEVIZE_MODEL_LICENSE_STATUS
  };
  delete process.env.LEEVIZE_COMFYUI_URL;
  delete process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH;
  delete process.env.LEEVIZE_MODEL_LICENSE_STATUS;
  try {
    const status = await probeOpenVideoRenderer();
    assert.equal(status.primary_lane, 'self_hosted_open_weight');
    assert.equal(status.vendor_credit_required, false);
    assert.equal(status.authority, 'none');
    assert.equal(status.ready, undefined);
    assert.equal(status.blocker, 'OPEN_RENDER_COMPUTE_UNCONFIGURED');
  } finally {
    if (previous.url === undefined) delete process.env.LEEVIZE_COMFYUI_URL; else process.env.LEEVIZE_COMFYUI_URL = previous.url;
    if (previous.workflow === undefined) delete process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH; else process.env.LEEVIZE_COMFYUI_WORKFLOW_PATH = previous.workflow;
    if (previous.license === undefined) delete process.env.LEEVIZE_MODEL_LICENSE_STATUS; else process.env.LEEVIZE_MODEL_LICENSE_STATUS = previous.license;
  }
});
