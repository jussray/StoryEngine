import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBoundedBytes } from '../lib/workerTransport.mjs';

const url='http://127.0.0.1:8188/history/example';
const fake=response=>async()=>response;
const opts={timeoutMs:1000,maxBytes:4};
test('bounded stream returns exact bytes',async()=>{
  const got=await fetchBoundedBytes(url,{}, {...opts,fetchImpl:fake(new Response(new Uint8Array([1,2,3,4])))});
  assert.deepEqual([...got],[1,2,3,4]);
});
test('rejects oversized declared or chunked response without unbounded buffering',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.enqueue(new Uint8Array([4,5,6]));},cancel(){cancelled=true;}});
  await assert.rejects(fetchBoundedBytes(url,{}, {...opts,fetchImpl:fake(new Response(stream))}),{code:'OPEN_RENDER_RESPONSE_TOO_LARGE'});
  assert.equal(cancelled,true);
  await assert.rejects(fetchBoundedBytes(url,{}, {...opts,fetchImpl:fake(new Response('12345',{headers:{'content-length':'5'}}))}),{code:'OPEN_RENDER_RESPONSE_TOO_LARGE'});
});
test('deadline includes body consumption after headers',async()=>{
  const fetchImpl=async(_url,{signal})=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}}));
  await assert.rejects(fetchBoundedBytes(url,{}, {maxBytes:4,timeoutMs:30,fetchImpl}),{code:'OPEN_RENDER_COMPUTE_TIMEOUT'});
});
test('HTTP failure is preserved and redirects are not followed',async()=>{
  await assert.rejects(fetchBoundedBytes(url,{}, {...opts,fetchImpl:async(_url,init)=>{assert.equal(init.redirect,'error');return new Response('error',{status:503});}}),{code:'COMFYUI_HTTP_503',status:503});
});
