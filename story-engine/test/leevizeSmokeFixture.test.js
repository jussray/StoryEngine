import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeFixture } from '../scripts/leevize-smoke-fixture.mjs';
test('deterministic smoke fixture has 81 model frames and 78 delivery frames',()=>{
 const a=smokeFixture(),b=smokeFixture();
 assert.equal(a.manifest.modelFrames,81);
 assert.equal(a.manifest.deliveryFrames,78);
 assert.equal(a.manifest.reference_sha256,b.manifest.reference_sha256);
 assert.equal(a.manifest.pixel_sha256,b.manifest.pixel_sha256);
 assert.equal(a.png.readUInt32BE(16),832);
 assert.equal(a.png.readUInt32BE(20),480);
});
