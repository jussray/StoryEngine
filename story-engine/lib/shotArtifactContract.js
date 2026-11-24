import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const fail = message => { throw Object.assign(new Error(message), {code:'OPEN_RENDER_SHOT_ARTIFACT_INVALID'}); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function run(binary,args,maxBuffer) {
  const result=spawnSync(binary,args,{timeout:180_000,maxBuffer,windowsHide:true});
  if(result.error||result.status!==0||!result.stdout?.length) fail('Media inspection failed.');
  return result.stdout;
}
export function inspectShotBoundary(file,deliveryFrames,{ffmpeg='ffmpeg',ffprobe='ffprobe'}={}) {
  const raw=run(ffprobe,['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames,r_frame_rate','-of','json',file],65536);
  let stream;
  try { stream=JSON.parse(raw.toString('utf8')).streams[0]; } catch { fail('Video stream metadata unavailable.'); }
  const count=Number(stream.nb_read_frames), width=Number(stream.width),height=Number(stream.height);
  if(!Number.isSafeInteger(count)||count<1||count>905||!Number.isSafeInteger(deliveryFrames)||deliveryFrames<1||deliveryFrames>count||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>1920||height>1920) fail('Decoded video outside shot frame or size contract.');
  const png=run(ffmpeg,['-nostdin','-v','error','-xerror','-i',file,'-map','0:v:0','-vf',`select=eq(n\\,${deliveryFrames-1})`,'-frames:v','1','-c:v','png','-threads','1','-f','image2pipe','pipe:1'],16*1024*1024);
  if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('Decoded boundary is not a PNG.');
  return {frame_count:count,delivery_frames:deliveryFrames,width,height,frame_rate:stream.r_frame_rate,tail_frame_sha256:digest(png),png};
}
function validBoundary(b) {
  return b&&validHash(b.tail_frame_sha256)&&Number.isSafeInteger(b.delivery_frames)&&b.delivery_frames>0;
}
// A deliberate cut has no parent. A chained shot is invalid if its immediate
// predecessor is missing, invalid, or changed at the delivered boundary.
export function invalidChainShots(entries) {
  const invalid=new Set(),ids=new Set();
  for(const [index,entry] of entries.entries()) {
    if(!entry||typeof entry.shot_id!=='string'||!entry.shot_id||ids.has(entry.shot_id)) fail('Invalid or duplicate shot identity.');
    ids.add(entry.shot_id);
    if(!validBoundary(entry.boundary)) invalid.add(entry.shot_id);
    if(entry.chain_from!=null) {
      const parent=entries[index-1],link=entry.chain_from;
      if(!parent||parent.shot_id!==link.shot_id||invalid.has(parent.shot_id)||!validBoundary(link)||link.tail_frame_sha256!==parent.boundary?.tail_frame_sha256||link.delivery_frames!==parent.boundary?.delivery_frames) invalid.add(entry.shot_id);
    }
  }
  return [...invalid];
}
