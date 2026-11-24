import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function inspectFrameChanges(file,frames,{ffmpeg='ffmpeg'}={}) {
  if(!Number.isInteger(frames)||frames<2||frames>905) throw new Error('INVALID_MOTION_FRAME_COUNT');
  const width=64,height=36,size=width*height*3;
  const p=spawnSync(ffmpeg,['-nostdin','-v','error','-xerror','-i',file,'-map','0:v:0','-vf','scale=64:36,format=rgb24','-frames:v',String(frames),'-fps_mode','passthrough','-f','rawvideo','-threads','1','pipe:1'],{timeout:180000,maxBuffer:size*frames+65536});
  if(p.error||p.status!==0||p.stdout?.length!==size*frames) throw new Error('MOTION_DECODE_FAILED');
  let changed=0,max=0,sum=0;
  for(let i=1;i<frames;i++){
    let delta=0;
    for(let j=0;j<size;j++)delta+=Math.abs(p.stdout[i*size+j]-p.stdout[(i-1)*size+j]);
    const mean=delta/size;
    if(mean>=1)changed++;
    max=Math.max(max,mean);sum+=mean;
  }
  return {sample_width:width,sample_height:height,decoded_frames:frames,changed_frame_pairs:changed,mean_absolute_rgb_delta:sum/(frames-1),max_pair_delta:max,threshold:1,frame_change_observed:changed>0,sample_sha256:createHash('sha256').update(p.stdout).digest('hex'),motion_authenticity_verified:false,causal_synchronization_verified:false};
}

export function gpuSnapshot(stats) {
  if(!Array.isArray(stats?.devices)) return null;
  const bytes=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
  return stats.devices.filter(d=>d&&typeof d==='object').map(d=>({type:typeof d.type==='string'?d.type:null,name:typeof d.name==='string'?d.name:null,vram_total:bytes(d.vram_total),vram_free:bytes(d.vram_free)}));
}
