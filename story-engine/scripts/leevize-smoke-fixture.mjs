import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { framePlan } from '../lib/renderGraphContract.js';

export function smokeFixture() {
  const width=832,height=480,fps=24,duration=3.25;
  const rgb=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*3;
    const ball=(x-270)**2+(y-240)**2<70**2;
    rgb[i]=ball?235:22+Math.floor(x*50/width);
    rgb[i+1]=ball?156:30+Math.floor(y*45/height);
    rgb[i+2]=ball?48:85;
  }
  const encoded=spawnSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',width+'x'+height,'-i','pipe:0','-frames:v','1','-c:v','png','-threads','1','-f','image2pipe','pipe:1'],{input:rgb,maxBuffer:8*1024*1024,timeout:30000});
  if(encoded.error||encoded.status!==0||!encoded.stdout?.length) throw new Error('Fixture PNG encoding failed.');
  return {png:encoded.stdout,manifest:{schema:'leevize/smoke-fixture@v1',aspect_ratio:'16:9',width,height,fps,duration_seconds:duration,...framePlan(duration,fps),reference_sha256:createHash('sha256').update(encoded.stdout).digest('hex'),pixel_sha256:createHash('sha256').update(rgb).digest('hex'),action:'The amber sphere rolls smoothly to the right across the blue surface. Fixed camera, stable lighting, no text.',steps:20,publication_authority:false}};
}
export function writeSmokeFixture(directory) {
  const {png,manifest}=smokeFixture();
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'reference.png'),png,{flag:'wx'});
  writeFileSync(join(directory,'fixture.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
