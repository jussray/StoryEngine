import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function importer() {
  const source = readFileSync(new URL('../public/makevideo_storyboard_import.js', import.meta.url), 'utf8');
  const context = { window: {} };
  runInNewContext(source, context, { timeout: 2000 });
  return context.window.MakeVideoStoryboardImport;
}
const shot = (i, duration = 4) => ({
  id: 'shot-' + i,
  title: 'Shot ' + i,
  visual: 'Camera follows subject ' + i,
  caption: 'On screen ' + i,
  duration
});
function storyboard(shots = [shot(1),shot(2)]) {
  return { schema: 'makevideo/storyboard/v1', title: 'Founder film', goal: 'Show the real work', format: '9:16', shots };
}
test('MakeVideo draft handoff retains directions without granting render or publication', () => {
  const result = importer().importStoryboard(storyboard());
  assert.equal(result.protocol_version,'makevideo/v2.1');
  assert.equal(result.count,2);
  assert.equal(result.total_seconds,8);
  assert.equal(result.aspect_ratio,'9:16');
  assert.equal(result.viewer_takeaway,'Show the real work');
  assert.deepEqual(Array.from(result.action_beats),['Camera follows subject 1','Camera follows subject 2']);
  assert.equal(result.authority_granted,false);
  assert.equal(result.submitted,false);
});
test('MakeVideo import fails closed on unknown version, excess shots or duration', () => {
  const parse = importer().importStoryboard;
  assert.throws(() => parse({...storyboard(), schema:'makevideo/storyboard/v2'}),/storyboard\/v1/);
  assert.throws(() => parse(storyboard(Array.from({length:13},(_,i)=>shot(i)))),/1–12/);
  assert.throws(() => parse(storyboard(Array.from({length:6},(_,i)=>shot(i,12)))),/60-second/);
  assert.throws(() => parse(storyboard([shot(1,0)])),/2 and 12/);
  assert.throws(() => parse(storyboard([{duration:4}])),/needs visual direction/);
});
test('MakeVideo handoff sanitizes text and ignores supplied authority claims', () => {
  const result=importer().importStoryboard({...storyboard([shot(1)]), authority_granted:true, title:' X '.repeat(100)});
  assert.equal(result.authority_granted,false);
  assert.equal(result.project_title.length<=100,true);
  assert.equal(result.action_beats.length,1);
  assert.equal(Object.isFrozen(result),true);
});
