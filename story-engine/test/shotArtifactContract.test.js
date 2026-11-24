import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectShotBoundary, invalidChainShots } from '../lib/shotArtifactContract.js';

const hash = c => c.repeat(64);
const boundary = (c, frames=48) => ({tail_frame_sha256:hash(c),delivery_frames:frames});
const entry = (id, b, parent=null) => ({shot_id:id,boundary:b,chain_from:parent});
const link = (id,c,frames=48) => ({shot_id:id,tail_frame_sha256:hash(c),delivery_frames:frames});

test('changed tail or timing invalidates chained descendants but not independent cuts',()=>{
  const a=entry('a',boundary('b'));
  const b=entry('b',boundary('c'),link('a','a'));
  const c=entry('c',boundary('d'),link('b','c'));
  const d=entry('d',boundary('e'));
  assert.deepEqual(invalidChainShots([a,b,c,d]),['b','c']);
  assert.deepEqual(invalidChainShots([entry('a',boundary('a',49)),b,c,d]),['b','c']);
  assert.deepEqual(invalidChainShots([entry('a',boundary('a')),b,c,d]),[]);
});
test('missing, forward and non-adjacent chain parents fail closed',()=>{
  assert.deepEqual(invalidChainShots([entry('a',null),entry('b',boundary('b'),link('a','a')),entry('c',boundary('c'),link('a','a'))]),['a','b','c']);
});
test('real decoded frame is bound to delivery count rather than model padding', t=>{
  const dir=mkdtempSync(join(tmpdir(),'leevize-shot-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'motion.mp4');
  const run=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=24','-frames:v','49','-c:v','libx264','-pix_fmt','yuv420p',file]);
  assert.equal(run.status,0,run.stderr?.toString());
  const a=inspectShotBoundary(file,48);
  const b=inspectShotBoundary(file,49);
  assert.equal(a.frame_count,49);
  assert.equal(a.delivery_frames,48);
  assert.equal(a.width,320);
  assert.match(a.tail_frame_sha256,/^[a-f0-9]{64}$/);
  assert.notEqual(a.tail_frame_sha256,b.tail_frame_sha256);
  assert.throws(()=>inspectShotBoundary(file,50));
});
