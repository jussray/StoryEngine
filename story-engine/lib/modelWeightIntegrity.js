import { createHash } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const fail = message => { throw Object.assign(new Error(message), {code:'OPEN_RENDER_WEIGHT_INTEGRITY_FAILED'}); };
export async function verifyModelWeights(model,modelsRoot) {
  const root=realpathSync(modelsRoot);
  const files=model?.weight_integrity?.files;
  const roles=['diffusion_model','text_encoder','vae'];
  if(!Array.isArray(files)||files.length!==3||!roles.every(role=>files.filter(f=>f.role===role).length===1)) fail('Incomplete weight pin set.');
  const evidence=[];
  for(const role of roles) {
    const pin=files.find(f=>f.role===role);
    if(typeof pin.path!=='string'||pin.path.split('/').at(-1)!==model[role]||!(/^[a-f0-9]{64}$/).test(pin.sha256)) fail('Invalid weight pin: '+role);
    const file=realpathSync(resolve(root,pin.path));
    const rel=relative(root,file);
    if(!rel||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel)) fail('Weight outside trusted root.');
    const before=statSync(file,{bigint:true});
    if(!before.isFile()||before.size===0n) fail('Weight not a regular nonempty file.');
    const hash=createHash('sha256');
    for await(const chunk of createReadStream(file)) hash.update(chunk);
    const after=statSync(file,{bigint:true});
    if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs) fail('Weight changed during verification.');
    const observed=hash.digest('hex');
    if(observed!==pin.sha256) fail('Weight checksum mismatch: '+role);
    evidence.push({role,filename:model[role],sha256:observed,bytes:Number(before.size)});
  }
  return {model_id:model.id,revision:model.weight_integrity.revision,files:evidence,scope:'local_files_only',verified_at:new Date().toISOString(),authority_granted:false};
}
