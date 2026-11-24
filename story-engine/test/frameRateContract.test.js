import test from 'node:test';
import assert from 'node:assert/strict';
import * as graph from '../lib/renderGraphContract.js';

test('frame rates accept integer, decimal and rational representations',()=>{
  for(const value of [24,'24','24/1',' 24 / 1 ','48/2']) assert.equal(graph.parseFrameRate(value),24);
  assert.equal(graph.parseFrameRate('24000/1001'),24000/1001);
  assert.equal(graph.parseFrameRate('23.976'),23.976);
});
test('frame rates reject empty, malformed, non-positive and nonfinite values',()=>{
  for(const value of [null,undefined,'',' ','/1','24/','24/0','24/1/1','-24','24/-1',0,Infinity,NaN,true,{},'0x18','1e2']) assert.ok(Number.isNaN(graph.parseFrameRate(value)),String(value));
});
