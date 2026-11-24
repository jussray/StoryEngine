// Direct diagnostic for a founder-controlled worker. Not a StoryEngine job or release.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyModelWeights } from '../lib/modelWeightIntegrity.js';
import { validateCompiledGraph, parseFrameRate } from '../lib/renderGraphContract.js';
import { inspectShotBoundary } from '../lib/shotArtifactContract.js';
import { smokeFixture } from './leevize-smoke-fixture.mjs';
import { completedVideo, saveVideoNodeId } from './wan22-smoke-output.mjs';
import { inspectFrameChanges, gpuSnapshot } from '../lib/frameChangeEvidence.js';
import { fetchBoundedBytes } from '../lib/workerTransport.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};
const readConfig=name=>JSON.parse(readFileSync(new URL('../config/'+name,import.meta.url),'utf8'));
const env=process.env;
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--submit'||env.LEEVIZE_WORKER_SMOKE_APPROVAL!=='one-shot-local-worker') fail('EXPLICIT_LOCAL_WORKER_APPROVAL_REQUIRED');
  if(Number(process.versions.node.split('.')[0])<24) fail('NODE_24_REQUIRED');
  if(env.LEEVIZE_MODEL_LICENSE_STATUS!=='verified-commercial'||!env.LEEVIZE_MODELS_ROOT||!env.LEEVIZE_RENDER_WORKER_ID||!env.LEEVIZE_WORKER_SMOKE_OUT) fail('WORKER_CONFIGURATION_REQUIRED');
  const base=new URL(env.LEEVIZE_COMFYUI_URL||'http://127.0.0.1:8188');
  if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash) fail('WORKER_LOOPBACK_ORIGIN_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(env.LEEVIZE_NODE_CONTRACT_SHA256||'')) fail('APPROVED_NODE_CONTRACT_PIN_REQUIRED');
  const started=Date.now(), deadline=started+15*60*1000;
  const request=async(path,init={},max=2*1024*1024)=>{
    const remaining=deadline-Date.now();
    if(remaining<=0)fail('WORKER_SMOKE_DEADLINE');
    return fetchBoundedBytes(new URL(path,base),{...init,headers:{...(env.LEEVIZE_COMFYUI_TOKEN?{Authorization:'Bearer '+env.LEEVIZE_COMFYUI_TOKEN}:{}),...init.headers}},{timeoutMs:Math.min(remaining,90000),maxBytes:max});
  };
  const json=async(path,init)=>JSON.parse((await request(path,init)).toString('utf8'));
  const exec=(bin,args)=>{
    const p=spawnSync(bin,args,{timeout:180000,maxBuffer:1024*1024,encoding:'utf8'});
    if(p.error||p.status!==0)fail('LOCAL_MEDIA_CHECK_FAILED');
  };
  exec('ffmpeg',['-version']);exec('ffprobe',['-version']);
  const manifest=readConfig('leevize-model-manifest.json');
  const model=manifest.models.find(m=>m.id===manifest.default_model_id);
  if(!model||model.id!=='wan2.2-ti2v-5b'||model.commercial_use_allowed!==true)fail('MODEL_NOT_APPROVED');
  const weights=await verifyModelWeights(model,env.LEEVIZE_MODELS_ROOT);
  const {png,manifest:fixture}=smokeFixture();
  if(!Buffer.isBuffer(png)||!png.length||hash(png)!==fixture.reference_sha256)fail('INVALID_SMOKE_REFERENCE_IMAGE');
  const graph=readConfig('leevize-wan22-ti2v-5b-api.json');
  const {compileComfyWorkflow}=await import('../lib/openVideoRenderer.js');
  const shot={shot_id:'wan22-smoke',duration_seconds:fixture.duration_seconds,provider_prompt:fixture.action,action:fixture.action,negative_constraints:['static subject','text','unrequested camera movement']};
  const job={workspace_id:'worker-smoke',source_revision_id:'wan22-smoke-v1',blueprint:{aspect_ratio:fixture.aspect_ratio,shots:[shot]}};
  const stats=await json('/system_stats');
  if(!Array.isArray(stats.devices)||!stats.devices.some(d=>d.type==='cuda'&&Number(d.vram_total)>0))fail('CUDA_WORKER_NOT_OBSERVED');
  const out=resolve(env.LEEVIZE_WORKER_SMOKE_OUT);
  mkdirSync(out,{recursive:false,mode:0o700});
  writeFileSync(join(out,'reference.png'),png,{flag:'wx'});
  const filename='leevize-smoke-'+randomUUID()+'.png';
  const form=new FormData();
  form.append('image',new Blob([png],{type:'image/png'}),filename);
  form.append('type','input');form.append('overwrite','false');
  const upload=await json('/upload/image',{method:'POST',body:form});
  if(upload.name!==filename||upload.type!=='input'||(upload.subfolder||'')!=='')fail('REFERENCE_UPLOAD_MISMATCH');
  const compiled=compileComfyWorkflow(graph,shot,job,0,{model,input_image_name:filename,fps:fixture.fps,width:fixture.width,height:fixture.height});
  const info=await json('/object_info');
  const requiredTypes=[...new Set(Object.values(graph).map(n=>n.class_type))];
  const proof=validateCompiledGraph(compiled,info,{requiredTypes,referenceName:filename});
  if(proof.node_contract_sha256!==env.LEEVIZE_NODE_CONTRACT_SHA256)fail('OPEN_RENDER_NODE_CONTRACT_DRIFT');
  const saveId=saveVideoNodeId(compiled);
  // Preserve correlation even if submission succeeds but its response is lost.
  const clientId='leevize-smoke-'+randomUUID();
  writeFileSync(join(out,'submission.json'),JSON.stringify({client_id:clientId,graph:proof,fixture,weights,submitted_at:new Date().toISOString(),publication_authority:false},null,2),{flag:'wx'});
  const submitted=await json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:compiled,client_id:clientId})});
  const promptId=submitted.prompt_id;
  if(typeof promptId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(promptId)||Object.keys(submitted.node_errors||{}).length)fail('WORKER_PROMPT_REJECTED_OR_UNKNOWN');
  writeFileSync(join(out,'prompt-id.txt'),promptId+'\n',{flag:'wx'});
  let media;
  while(Date.now()<deadline){
    const entry=(await json('/history/'+encodeURIComponent(promptId)))[promptId];
    if(entry){media=completedVideo(entry,saveId);if(media)break;}
    await delay(Math.min(2000,Math.max(0,deadline-Date.now())));
  }
  if(!media)fail('WORKER_SMOKE_DEADLINE');
  const params=new URLSearchParams({filename:media.filename,subfolder:media.subfolder||'',type:'output'});
  const bytes=await request('/view?'+params,{},512*1024*1024);
  if(!bytes.length)fail('EMPTY_MODEL_OUTPUT');
  const source=join(out,'model-output.'+media.filename.split('.').at(-1).toLowerCase());
  writeFileSync(source,bytes,{flag:'wx'});
  exec('ffmpeg',['-nostdin','-v','error','-xerror','-i',source,'-map','0:v:0','-f','null','-']);
  const {png:tail,...boundary}=inspectShotBoundary(source,fixture.deliveryFrames);
  const fps=parseFrameRate(boundary.frame_rate);
  if(boundary.frame_count!==fixture.modelFrames||boundary.width!==fixture.width||boundary.height!==fixture.height||fps!==fixture.fps)fail('WORKER_MEDIA_CONTRACT_MISMATCH');
  writeFileSync(join(out,'delivery-tail.png'),tail,{flag:'wx'});
  const motion=inspectFrameChanges(source,fixture.deliveryFrames);
  if(!motion.frame_change_observed)fail('SMOKE_FRAME_CHANGE_NOT_OBSERVED');
  const trimmed=join(out,'delivery.mp4');
  exec('ffmpeg',['-nostdin','-n','-v','error','-xerror','-i',source,'-map','0:v:0','-an','-frames:v',String(fixture.deliveryFrames),'-c:v','libx264','-pix_fmt','yuv420p',trimmed]);
  const {png:unused,...delivery}=inspectShotBoundary(trimmed,fixture.deliveryFrames);
  if(delivery.frame_count!==fixture.deliveryFrames||delivery.width!==fixture.width||delivery.height!==fixture.height||parseFrameRate(delivery.frame_rate)!==fixture.fps)fail('DELIVERY_TRIM_MISMATCH');
  exec('ffmpeg',['-nostdin','-v','error','-xerror','-i',trimmed,'-map','0:v:0','-f','null','-']);
  const postStats=await json('/system_stats').catch(()=>null);
  const receipt={reference_sha256:hash(png),delivery_tail_sha256:hash(tail),delivery_bytes:readFileSync(trimmed).length,motion,gpu_devices_before:gpuSnapshot(stats),gpu_devices_after:gpuSnapshot(postStats),scope:'direct_worker_diagnostic',prompt_id:promptId,worker_id:env.LEEVIZE_RENDER_WORKER_ID,model_id:model.id,graph:proof,weights,model_output_sha256:hash(bytes),model_output_bytes:bytes.length,boundary,delivery,delivery_sha256:hash(readFileSync(trimmed)),elapsed_ms:Date.now()-started,gpu_devices:gpuSnapshot(stats),peak_vram_verified:false,storyengine_job_verified:false,loaded_weight_attestation_verified:false,publication_authority:false};
  writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error('Direct worker smoke blocked: '+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'RUNTIME_OR_TRANSPORT_ERROR'));process.exitCode=1;});
