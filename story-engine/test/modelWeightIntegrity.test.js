import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyModelWeights } from '../lib/modelWeightIntegrity.js';
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
