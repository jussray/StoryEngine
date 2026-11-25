import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyModelWeights, resolveManifestModel } from '../lib/modelWeightIntegrity.js';
test('hashes actual files and rejects changed weights and filename overrides',async t=>{
 const root=mkdtempSync(join(tmpdir(),'weight-test-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const model={id:'fixture',weight_integrity:{revision:'fixture',files:[]}};
 for(const role of ['diffusion_model','text_encoder','vae']){
   mkdirSync(join(root,role));
   model[role]=role+'.safetensors';
   const path=role+'/'+model[role];
   const bytes=Buffer.from(role);
   writeFileSync(join(root,path),bytes);
   model.weight_integrity.files.push({role,path,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 assert.equal((await verifyModelWeights(model,root)).files.length,3);
 writeFileSync(join(root,model.weight_integrity.files[0].path),'changed');
 await assert.rejects(verifyModelWeights(model,root),/checksum mismatch/);
 model.diffusion_model='override.safetensors';
 await assert.rejects(verifyModelWeights(model,root),/Invalid weight pin/);
});

test('manifest approval cannot be inherited by replacement weight filenames',()=>{
 const entry={id:'fixture',license:'Apache-2.0',commercial_use_allowed:true,diffusion_model:'model.safetensors',text_encoder:'encoder.safetensors',vae:'vae.safetensors',weight_integrity:{files:[]}};
 for(const role of ['diffusion_model','text_encoder','vae'])entry.weight_integrity.files.push({role,path:role+'/'+entry[role],sha256:'a'.repeat(64)});
 const manifest={default_model_id:'fixture',models:[entry]};
 const approved={LEEVIZE_MODEL_LICENSE_STATUS:'verified-commercial'};
 assert.equal(resolveManifestModel(manifest,approved).verified,true);
 assert.equal(resolveManifestModel(manifest,{...approved,LEEVIZE_WAN_MODEL:'other.safetensors'}).verified,false);
 assert.equal(resolveManifestModel(manifest,{...approved,LEEVIZE_WAN_TEXT_ENCODER:'other.safetensors'}).verified,false);
 assert.equal(resolveManifestModel(manifest,{...approved,LEEVIZE_WAN_VAE:'other.safetensors'}).verified,false);
 assert.equal(resolveManifestModel(manifest,{...approved,LEEVIZE_MODEL_ID:'unknown'}).verified,false);
 assert.equal(resolveManifestModel(manifest,{}).verified,false);
 assert.equal(resolveManifestModel({default_model_id:'fixture',models:[{...entry,weight_integrity:{files:[]}}]},approved).verified,false);
 assert.equal(resolveManifestModel(manifest,{...approved,LEEVIZE_WAN_MODEL:'model.safetensors'}).verified,true);
});
