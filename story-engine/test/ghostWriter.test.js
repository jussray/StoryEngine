import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVoiceFingerprint, ghostHumanizePass, ghostCommandOptions, draftStoryUnit } from '../lib/ghostWriter.js';

test('Ghost builds a voice fingerprint from creative profile and intent', () => {
  const fingerprint = buildVoiceFingerprint(
    { audience: 'eli10', medium: 'picture_book', tone: 'warm', constraints: ['present tense'] },
    { story_kind: 'educational', emotional_effect: 'wonder', outputs: ['youtube_short'] }
  );
  assert.equal(fingerprint.audience, 'eli10');
  assert.equal(fingerprint.medium, 'picture_book');
  assert.match(fingerprint.sentence_rhythm, /18 words/);
  assert.ok(fingerprint.constraints.includes('present tense'));
  assert.ok(fingerprint.outputs.includes('youtube_short'));
});

test('Ghost humanize pass strips common AI-signaling phrases', () => {
  const text = ghostHumanizePass('Furthermore, the child learned. In conclusion, the garden was a tapestry of wonder. Needless to say, it was a beacon that underscores the journey.');
  assert.doesNotMatch(text, /Furthermore/i);
  assert.doesNotMatch(text, /In conclusion/i);
  assert.doesNotMatch(text, /tapestry/i);
  assert.doesNotMatch(text, /Needless to say/i);
  assert.doesNotMatch(text, /beacon/i);
  assert.doesNotMatch(text, /underscores/i);
  assert.doesNotMatch(text, /journey/i);
});

test('Ghost humanize pass does not inject fixed cadence fragments', () => {
  const text = ghostHumanizePass('The cat sat. The dog ran. The sun rose.');
  assert.doesNotMatch(text, /For a second, nothing moved/);
  assert.doesNotMatch(text, /Then—quietly—it changed/);
});

test('Ghost commands expose draft, humanize, suggest, and rewrite', () => {
  const commands = ghostCommandOptions().map(item => item.command);
  assert.deepEqual(commands, ['/ghost draft', '/ghost humanize', '/ghost suggest', '/ghost rewrite']);
});

test('Ghost draft falls back safely when no provider key is configured', async () => {
  const priorAnthropic = process.env.ANTHROPIC_API_KEY;
  const priorOpenAI = process.env.OPENAI_API_KEY;
  const priorOpenRouter = process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const draft = await draftStoryUnit(
    { title: 'Little Cloud Garden', story_vision: 'A cloud learns rain helps flowers grow.', audience: 'eli5', medium: 'picture_book', story_kind: 'educational' },
    { audience: 'eli5', medium: 'picture_book', tone: 'gentle' }
  );

  assert.equal(draft.status, 'fallback_stub');
  assert.match(draft.draft_unit, /Little Cloud Garden/);
  assert.match(draft.draft_unit, /Human decision needed/);

  if (priorAnthropic) process.env.ANTHROPIC_API_KEY = priorAnthropic;
  if (priorOpenAI) process.env.OPENAI_API_KEY = priorOpenAI;
  if (priorOpenRouter) process.env.OPENROUTER_API_KEY = priorOpenRouter;
});
