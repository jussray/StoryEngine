import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectFrameChanges, gpuSnapshot } from '../lib/frameChangeEvidence.js';
test('real decoded frames distinguish static from varying content without claiming authentic motion',t=>{
 const dir=mkdtempSync(join(tmpdir(),'frame-change-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const [name,src,expected] of [['static','color=c=blue:s=320x240:r=24',false],['moving','testsrc2=size=320x240:rate=24',true]]){
  const file=join(dir,name+'.mp4');
  const p=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i',src,'-frames:v','48','-c:v','libx264','-pix_fmt','yuv420p',file]);
  assert.equal(p.status,0);
  const observed=inspectFrameChanges(file,48);
  assert.equal(observed.frame_change_observed,expected);
  assert.equal(observed.motion_authenticity_verified,false);
  assert.equal(observed.causal_synchronization_verified,false);
  assert.throws(()=>inspectFrameChanges(file,49),/MOTION_DECODE_FAILED/);
 }
});
test('missing telemetry remains null, not fabricated zero',()=>{
 assert.equal(gpuSnapshot(null),null);
 assert.deepEqual(gpuSnapshot({devices:[{type:'cuda',vram_total:100,vram_free:null},{type:'cuda',vram_total:200,vram_free:0}]}).map(d=>d.vram_free),[null,0]);
});
