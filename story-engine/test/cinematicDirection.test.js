import test from 'node:test';
import assert from 'node:assert/strict';
import { cinematicDirection, CINEMATIC_PROFILE } from '../lib/cinematicDirection.js';
import { compileComfyWorkflow } from '../lib/openVideoRenderer.js';
import { createContinuityCookie } from '../lib/videoContinuity.js';

const fixture = () => {
  const shot = {shot_id:'s1',duration_seconds:5,provider_prompt:'Loop walks to the workstation.', action:'Loop reaches the glass desk', camera_move:'dolly in', must_preserve:['violet infinity emblem'], negative_constraints:['identity drift'],shot_direction:{opening_frame:'Loop at window',ending_frame:'Loop touches desk'}};
  const job = {workspace_id:'w1',source_revision_id:'r1',blueprint:{cinematic_profile:CINEMATIC_PROFILE,visual_style:'cinematic_realism',aspect_ratio:'9:16',world_bible:{palette:'violet and amber'},shots:[shot]}};
  return {job,shot};
};
test('director preserves product canon, action, framing and distinct environmental motion',()=>{
  const {job,shot}=fixture();
  const d=cinematicDirection(shot,job);
  for(const phrase of ['Loop reaches the glass desk','dolly in','violet infinity emblem','Loop at window','Loop touches desk','violet and amber','independent subject']) assert.ok(d.prompt.includes(phrase),phrase);
  assert.match(d.negative,/static poster/);
  assert.match(d.negative,/identity drift/);
});
test('existing renderer uses director only for explicit profile and legacy stays unchanged',()=>{
  const {job,shot}=fixture();
  const workflow={p:'__LEEVIZE_PROMPT__',n:'__LEEVIZE_NEGATIVE_PROMPT__'};
  const model={diffusion_model:'d',text_encoder:'e',vae:'v'};
  assert.match(compileComfyWorkflow(workflow,shot,job,0,{model}).p,/independent subject/);
  delete job.blueprint.cinematic_profile;
  assert.equal(compileComfyWorkflow(workflow,shot,job,0,{model}).p,shot.provider_prompt);
});
test('direction changes invalidate prior proof; legacy jobs preserve legacy shape',()=>{
  const {job,shot}=fixture();
  const before=createContinuityCookie(job).value;
  shot.camera_move='static';
  assert.notEqual(createContinuityCookie(job).value,before);
  delete job.blueprint.cinematic_profile;
  const legacy=createContinuityCookie(job).value;
  shot.camera_move='pan right';
  assert.equal(createContinuityCookie(job).value,legacy);
});
test('template interpolation never recursively substitutes user text',()=>{
  const {job,shot}=fixture();
  shot.provider_prompt='Literal __LEEVIZE_SEED__ sign';
  const workflow={p:'prefix __LEEVIZE_PROMPT__ suffix'};
  const model={diffusion_model:'d',text_encoder:'e',vae:'v'};
  assert.match(compileComfyWorkflow(workflow,shot,job,0,{model}).p,/Literal __LEEVIZE_SEED__ sign/);
});
