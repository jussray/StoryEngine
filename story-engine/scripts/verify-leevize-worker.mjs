import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { verifyModelWeights } from '../lib/modelWeightIntegrity.js';
const manifest=JSON.parse(readFileSync(new URL('../config/leevize-model-manifest.json',import.meta.url),'utf8'));
const model=manifest.models.find(m=>m.id===manifest.default_model_id);
try{
 if(!process.env.LEEVIZE_MODELS_ROOT) throw new Error('LEEVIZE_MODELS_ROOT required on actual worker.');
 const tools={};
 for(const name of ['ffmpeg','ffprobe']){
   const p=spawnSync(name,['-version'],{encoding:'utf8',timeout:10000});
   if(p.error||p.status!==0)throw new Error(name+' unavailable');
   tools[name]=p.stdout.split('\n')[0];
 }
 const weights=await verifyModelWeights(model,process.env.LEEVIZE_MODELS_ROOT);
 console.log(JSON.stringify({weights,tools,gpu_inference_verified:false,publication_authority:false},null,2));
}catch(error){console.error('Worker preflight blocked: '+(error.code||'LOCAL_CHECK_FAILED'));process.exitCode=1;}
