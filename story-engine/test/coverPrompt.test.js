import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverPrompt } from '../lib/coverPrompt.js';

test('cover prompts use story content and exclude invented authors', () => {
  const result = buildCoverPrompt({
    story: { title: 'The Glass Harbor', genre: 'mystery' },
    intent: { medium: 'novel', audience: 'adult' },
    profile: { resolved_rules: { tone: 'restrained' } },
    chapters: [
      { content: 'At dawn the harbor was empty.' },
      { content: 'The letter changed everything.' },
      { content: 'A choice had to be made.' }
    ]
  });
  assert.match(result.prompt, /The Glass Harbor/);
  assert.match(result.prompt, /restrained/);
  assert.match(result.prompt, /At dawn/);
  assert.match(result.prompt, /The letter/);
  assert.match(result.prompt, /Do not render any letters/);
  assert.doesNotMatch(result.prompt, /Author \(context only\)/);
  assert.equal(result.prompt_hash, buildCoverPrompt({
    story: { title: 'The Glass Harbor', genre: 'mystery' },
    intent: { medium: 'novel', audience: 'adult' },
    profile: { resolved_rules: { tone: 'restrained' } },
    chapters: [
      { content: 'At dawn the harbor was empty.' },
      { content: 'The letter changed everything.' },
      { content: 'A choice had to be made.' }
    ]
  }).prompt_hash);
});
test('missing title is not silently invented', () => {
  assert.throws(() => buildCoverPrompt({}), /title/);
});
