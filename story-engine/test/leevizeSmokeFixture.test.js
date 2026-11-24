import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeFixture } from '../scripts/leevize-smoke-fixture.mjs';
test('deterministic smoke fixture has 121 model frames and 120 delivery frames',()=>{
 const a=smokeFixture(),b=smokeFixture();
 assert.equal(a.manifest.modelFrames,121);
 assert.equal(a.manifest.deliveryFrames,120);
 assert.equal(a.manifest.reference_sha256,b.manifest.reference_sha256);
 assert.equal(a.manifest.pixel_sha256,b.manifest.pixel_sha256);
 assert.equal(a.png.readUInt32BE(16),832);
 assert.equal(a.png.readUInt32BE(20),480);
});
