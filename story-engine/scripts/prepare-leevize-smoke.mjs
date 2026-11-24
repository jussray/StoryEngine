import { writeSmokeFixture } from './leevize-smoke-fixture.mjs';
if(process.argv.length!==3) throw new Error('Usage: node scripts/prepare-leevize-smoke.mjs NEW_DIRECTORY');
console.log(JSON.stringify(writeSmokeFixture(process.argv[2]),null,2));
