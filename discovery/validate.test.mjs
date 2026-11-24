import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate,graph} from './validate.mjs';
import {expected} from './identity.mjs';
const read=p=>JSON.parse(readFileSync(new URL('./'+p,import.meta.url),'utf8'));
test('source-only identity and registries match the declared product',()=>{const m=read('project.json');assert.equal(validate(m,expected),true);assert.deepEqual(read('knowledge.draft.jsonld'),graph(m,expected));assert.deepEqual(read('capabilities.json'),{project:m.project,status:'draft',intendedUseCases:m.intendedUseCases,verifiedCapabilities:[]});assert.deepEqual(read('evidence.json'),{project:m.project,status:'draft',productionStatus:'UNKNOWN',publicEvidence:[]});});
test('rejects promotion, fabricated evidence, extra fields, and URL drift',()=>{const m=read('project.json');for(const patch of [{publicationStatus:'published'},{productionStatus:'VERIFIED'},{verifiedCapabilities:['production']},{publicEvidence:['unverified']},{token:'secret'},{publicPage:'https://invalid.example/'},{source:'https://invalid.example/'},{name:'Other product'},{intendedUseCases:['guaranteed result']}])assert.throws(()=>validate({...m,...patch},expected));});
