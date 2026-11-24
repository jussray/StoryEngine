#!/usr/bin/env node
// Operator-only smoke test. Defaults to read-only preflight. Never retries submission.
import { readFileSync, writeFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const fail = code => { throw new Error(code); };
const hash = b => createHash('sha256').update(b).digest('hex');
const MAX_MEDIA = 512 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const env = process.env;
const base = new URL(env.LEEVIZE_SMOKE_ORIGIN || 'http://127.0.0.1:3000');
if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname)))) fail('INVALID_ORIGIN');
const headers = { Accept:'application/json', ...(env.LEEVIZE_SMOKE_COOKIE ? {Cookie:env.LEEVIZE_SMOKE_COOKIE} : {}) };
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail('INVALID_ID');
  return encodeURIComponent(value);
};
async function request(path, init={}, max=MAX_JSON) {
  const res = await fetch(new URL(path,base), {...init, headers:{...headers,...init.headers}, redirect:'error',signal:AbortSignal.timeout(90000)});
  if (!res.ok) fail('HTTP_'+res.status);
  if (Number(res.headers.get('content-length')||0)>max || !res.body) fail('RESPONSE_SIZE');
  const chunks=[];let total=0;
  for await (const chunk of res.body) {
    total+=chunk.length;
    if(total>max) fail('RESPONSE_SIZE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks,total);
}
async function json(path, init) { return JSON.parse((await request(path,init)).toString('utf8')); }
function command(bin,args) {
  const result=spawnSync(bin,args,{encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
  if(result.error||result.status!==0) fail('LOCAL_MEDIA_VERIFICATION_FAILED');
  return result.stdout;
}
async function main() {
  const args=process.argv.slice(2);
  if (args.length && (args.length!==1 || args[0]!=='--submit')) fail('USE_NO_ARGS_OR_SUBMIT');
  const preflight=await json('/api/video-engine/open-renderer/status');
  console.log(JSON.stringify({phase:'preflight',ready:preflight.ready===true,renderer:preflight.renderer,blockers:(preflight.blockers||[]).map(b=>b.code),authority_granted:false}));
  if(preflight.ready!==true || preflight.primary_lane!=='self_hosted_open_weight' || preflight.vendor_credit_required!==false) fail('WORKER_NOT_READY');
  if(!args.length) return;
  if(env.LEEVIZE_SMOKE_APPROVAL!=='one-shot-existing-worker' || !env.LEEVIZE_SMOKE_COOKIE) fail('EXPLICIT_OPERATOR_APPROVAL_REQUIRED');
  const jobId=id(env.LEEVIZE_SMOKE_JOB_ID), shotId=id(env.LEEVIZE_SMOKE_SHOT_ID);
  const jobPath='/api/video-engine/jobs/'+jobId;
  const job=await json(jobPath);
  const shot=job.blueprint?.shots?.find(s=>s.shot_id===shotId);
  if(!['preview_validated','validated'].includes(job.status)||!shot||!(shot.duration_seconds>=1&&shot.duration_seconds<=5)) fail('APPROVED_SHORT_SHOT_REQUIRED');
  const ref=env.LEEVIZE_SMOKE_REFERENCE;
  if(!ref || !statSync(ref).isFile() || statSync(ref).size>12*1024*1024) fail('REFERENCE_REQUIRED');
  const mime=ref.toLowerCase().endsWith('.png')?'image/png':ref.toLowerCase().endsWith('.webp')?'image/webp':/\.jpe?g$/i.test(ref)?'image/jpeg':null;
  if(!mime) fail('REFERENCE_FORMAT');
  const bytes=readFileSync(ref);
  const fixturePath=env.LEEVIZE_SMOKE_FIXTURE_MANIFEST;
  if(!fixturePath||statSync(fixturePath).size>65536) fail('FIXTURE_MANIFEST_REQUIRED');
  const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
  if(fixture.schema!=='leevize/smoke-fixture@v1'||fixture.reference_sha256!==hash(bytes)||fixture.modelFrames!==121||fixture.deliveryFrames!==120||fixture.fps!==24||fixture.width!==832||fixture.height!==480||fixture.duration_seconds!==5||shot.duration_seconds!==5||job.blueprint.aspect_ratio!=='16:9'||shot.action!==fixture.action) fail('FIXTURE_CONTRACT_MISMATCH');
  const prior=await json(jobPath+'/open-renders');
  if((prior.renders||[]).some(r=>r.shot_id===shotId&&['submitted','rendering'].includes(r.status))) fail('EXISTING_RENDER_IN_FLIGHT');
  const started=Date.now();
  const submitted=await json(jobPath+'/open-render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shot_id:shotId,reference_image_data_url:'data:'+mime+';base64,'+bytes.toString('base64'),attempt:0,cost_ceiling_micros:0})});
  const renderId=id(submitted.render_id);
  console.log(JSON.stringify({phase:'submitted',render_id:renderId}));
  const pollPath='/api/video-engine/open-renders/'+renderId;
  let result=submitted;
  const deadline=started+15*60*1000;
  while(!['complete','failed'].includes(result.status)&&Date.now()<deadline) {
    await delay(3000);
    result=await json(pollPath);
  }
  if(result.status!=='complete') fail('RENDER_NOT_COMPLETE_RECONCILE_'+renderId);
  if(result.receipt?.execution_class!=='self_hosted_open_weight'||result.receipt?.authority_granted!==false||result.technical_status!=='passed') fail('RENDER_EVIDENCE_INVALID');
  const media=await request(pollPath+'/media',{},MAX_MEDIA);
  const sha=hash(media);
  if(sha!==result.output_sha256||sha!==result.receipt.output_sha256) fail('ARTIFACT_HASH_MISMATCH');
  const dir=mkdtempSync(join(tmpdir(),'leevize-smoke-'));
  try {
    const file=join(dir,'shot.mp4');writeFileSync(file,media,{flag:'wx'});
    const probe=JSON.parse(command('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames,r_frame_rate:format=duration','-of','json',file]));
    const v=probe.streams?.[0], expected=result.receipt.output_contract;
    if(!v||!expected||expected.frames!==fixture.modelFrames||expected.delivery_frames!==fixture.deliveryFrames||expected.fps!==fixture.fps||v.width!==fixture.width||v.height!==fixture.height||Number(v.nb_read_frames)!==expected.frames) fail('DECODED_CONTRACT_MISMATCH');
    command('ffmpeg',['-nostdin','-v','error','-xerror','-i',file,'-map','0:v:0','-f','null','-']);
    console.log(JSON.stringify({phase:'artifact_verified',render_id:renderId,sha256:sha,frames:Number(v.nb_read_frames),width:v.width,height:v.height,elapsed_ms:Date.now()-started,expected_source_sha:env.LEEVIZE_SMOKE_EXPECTED_SHA||null,deployed_source_sha_verified:false,peak_vram_verified:false,publication_authority:false}));
  } finally {rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error('Smoke blocked: '+(/^[A-Z0-9_-]+$/.test(error.message)?error.message:'REQUEST_OR_RUNTIME_ERROR'));process.exitCode=1;});
