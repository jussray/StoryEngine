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
  assert.ok(fingerprint.specificity_rules.some(rule => /clusters rather than banning individual words or punctuation/.test(rule)));
});

test('Ghost humanize pass preserves valid vocabulary and punctuation while cleaning mechanics', () => {
  const text = ghostHumanizePass('Furthermore,  the crucial detail—her red umbrella—mattered .\n\n\nIn conclusion, she left.');
  assert.match(text, /Furthermore/);
  assert.match(text, /crucial/);
  assert.match(text, /—her red umbrella—/);
  assert.match(text, /In conclusion/);
  assert.doesNotMatch(text, /  /);
  assert.doesNotMatch(text, /\n{3,}/);
  assert.doesNotMatch(text, /mattered \./);
});

test('Ghost humanize pass does not inject fixed cadence fragments', () => {
  const text = ghostHumanizePass('The cat sat. The dog ran. The sun rose.');
  assert.doesNotMatch(text, /For a second, nothing moved/);
  assert.doesNotMatch(text, /Then—quietly—it changed/);
});

test('Ghost commands expose draft, humanize, suggest, and rewrite', () => {
  const options = ghostCommandOptions();
  assert.deepEqual(options.map(item => item.command), ['/ghost draft', '/ghost humanize', '/ghost suggest', '/ghost rewrite']);
  assert.match(options.find(item => item.command === '/ghost humanize').description, /voice-density audit/);
});

test('Ghost draft falls back safely when no provider key is configured', async () => {
  const priorAnthropic = process.env.ANTHROPIC_API_KEY;
  const priorOpenAI = process.env.OPENAI_API_KEY;
  const priorOpenRouter = process.env.OPENROUTER_API_KEY;
  try {
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
    assert.equal(draft.humanize_pass.authorship_inference, 'not_supported');
  } finally {
    if (priorAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorAnthropic;
    if (priorOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAI;
    if (priorOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorOpenRouter;
  }
});
