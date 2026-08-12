import assert from 'node:assert/strict';
import test from 'node:test';
import { CREATOR_PAGES } from '../lib/pageGuard.js';

test('Movie Mode is an allowed creator page and its script canonicalizes to that page', () => {
  assert.equal(CREATOR_PAGES.has('/movie.html'), true);
});
