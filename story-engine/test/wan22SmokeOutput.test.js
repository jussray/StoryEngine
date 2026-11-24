import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSavedVideo, completedVideo } from '../scripts/wan22-smoke-output.mjs';
const item={filename:'shot_00001.mp4',subfolder:'video/leevize',type:'output'};
for(const bucket of ['videos','animated','images']){
 test('accepts SaveVideo '+bucket+' only after successful completion',()=>{
   const entry={outputs:{'58':{[bucket]:[item]},'99':{videos:[{filename:'wrong.mp4'}]}}};
   assert.equal(completedVideo(entry,'58'),null);
   entry.status={completed:true,status_str:'success'};
   assert.deepEqual(completedVideo(entry,'58'),item);
 });
}
test('rejects path traversal, temporary outputs and unrelated nodes',()=>{
 for(const bad of [{...item,filename:'../shot.mp4'},{...item,subfolder:'video/../secret'},{...item,type:'temp'}]){
   assert.equal(selectSavedVideo({outputs:{'58':{videos:[bad]}}},'58'),null);
 }
 assert.equal(selectSavedVideo({outputs:{'99':{videos:[item]}}},'58'),null);
});
test('fails on ambiguous output, OOM and completed missing output',()=>{
 assert.throws(()=>selectSavedVideo({outputs:{'58':{videos:[item,item]}}},'58'),/AMBIGUOUS/);
 assert.throws(()=>completedVideo({status:{messages:[['execution_error',{exception_type:'OutOfMemoryError'}]]}},'58'),/GPU_OOM/);
 assert.throws(()=>completedVideo({status:{completed:true,status_str:'success'}},'58'),/OUTPUT_MISSING/);
});
