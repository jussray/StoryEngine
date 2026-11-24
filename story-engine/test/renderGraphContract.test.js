import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompiledGraph, framePlan, classifyHistory, repairSelection } from '../lib/renderGraphContract.js';

const info = {
  LoadImage:{input:{required:{image:[['canon.png']] }},output:['IMAGE']},
  SaveVideo:{input:{required:{video:['IMAGE']}},output:[],output_node:true}
};
const graph = { '1':{class_type:'LoadImage',inputs:{image:'canon.png'}},'2':{class_type:'SaveVideo',inputs:{video:['1',0]}} };
test('validates actual graph against worker input and output contract',()=>{
  assert.equal(validateCompiledGraph(graph,info,{requiredTypes:['LoadImage','SaveVideo'],referenceName:'canon.png'}).nodes,2);
});
test('blocks missing nodes, broken edges, mismatched reference and cycles',()=>{
  for(const bad of [
    {...graph,'2':{class_type:'Missing',inputs:{}}},
    {...graph,'2':{class_type:'SaveVideo',inputs:{video:['9',0]}}},
    {...graph,'1':{class_type:'LoadImage',inputs:{image:'other.png'}}},
    {...graph,'2':{class_type:'SaveVideo',inputs:{video:['2',0]}}}
  ]) assert.throws(()=>validateCompiledGraph(bad,info,{requiredTypes:['LoadImage','SaveVideo'],referenceName:'canon.png'}));
});
test('frame planning preserves precise delivery timing and pads Wan frames',()=>{
  assert.deepEqual(framePlan(2.01,24),{deliveryFrames:49,modelFrames:49,fps:24});
  assert.deepEqual(framePlan(2,24),{deliveryFrames:48,modelFrames:49,fps:24});
  assert.throws(()=>framePlan(16,24));
});
test('history distinguishes OOM, interruptions and successful empty output',()=>{
  assert.equal(classifyHistory({status:{messages:[['execution_error',{exception_type:'OutOfMemoryError'}]]}},false),'OPEN_RENDER_GPU_OOM');
  assert.equal(classifyHistory({status:{messages:[['execution_interrupted',{}]]}},false),'OPEN_RENDER_INTERRUPTED');
  assert.equal(classifyHistory({status:{completed:true,status_str:'success'}},false),'OPEN_RENDER_OUTPUT_MISSING');
  assert.equal(classifyHistory({status:{completed:true,status_str:'success'}},true),null);
});
test('repair selection preserves passing shots and caps attempts',()=>{
  assert.deepEqual(repairSelection([{id:'a',passed:true},{id:'b',passed:false,attempt:0},{id:'c',passed:false,attempt:2}],2),{retry:['b'],blocked:['c']});
});
