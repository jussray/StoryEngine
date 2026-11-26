import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/story_engine.js',import.meta.url),'utf8');
test('failed start and approval clear stale Amethyst status before alert',()=>{const catches=source.match(/catch \(error\) \{\s*window\.storyCompanion\?\.setActive\(false\);\s*alert\(creatorCopy\(error\.message\)\);/g);assert.equal(catches?.length,2);});
