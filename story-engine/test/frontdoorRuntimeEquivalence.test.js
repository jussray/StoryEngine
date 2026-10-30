import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveExpectedRuntimeSha, runtimeRelevantPaths } from '../cloudflare-frontdoor/proof/runtime-equivalence.js';

const LIVE = '0a1d3b521967a3643daf56cf2ad60b1392bb6e0c';
const MAIN = '4ec29c1821de8c7bb8c381df31e3f98d0c6016f4';
// Real `git diff --name-only 0a1d3b5 4ec29c1` on 2026-10-02.
const EDGE_ONLY = [
  '.github/workflows/guardrails-playwright.yml',
  '.gitignore',
  'story-engine/cloudflare-frontdoor/worker.js',
  'story-engine/test/cloudflareFrontdoor.test.js',
  'story-engine/wrangler.jsonc'
];

test('edge/test/CI-only lag resolves to the live release, not latest main', () => {
  const result = resolveExpectedRuntimeSha({ liveSha: LIVE, targetSha: MAIN, liveIsAncestorOfTarget: true, changedPaths: EDGE_ONLY });
  assert.deepEqual(result, { expected: LIVE, equivalence: 'runtime-identical', undeployed: [] });
});

test('an exact match needs no equivalence argument', () => {
  assert.equal(resolveExpectedRuntimeSha({ liveSha: MAIN, targetSha: MAIN, liveIsAncestorOfTarget: true, changedPaths: [] }).equivalence, 'exact');
});

test('an undeployed runtime change fails closed and names the files', () => {
  assert.throws(
    () => resolveExpectedRuntimeSha({ liveSha: LIVE, targetSha: MAIN, liveIsAncestorOfTarget: true, changedPaths: [...EDGE_ONLY, 'story-engine/server.js', 'story-engine/Dockerfile'] }),
    /missing runtime changes .*story-engine\/server\.js, story-engine\/Dockerfile/
  );
});

test('a live release that is not an ancestor of the target fails closed', () => {
  assert.throws(
    () => resolveExpectedRuntimeSha({ liveSha: LIVE, targetSha: MAIN, liveIsAncestorOfTarget: false, changedPaths: [] }),
    /not an ancestor/
  );
});

test('non-exact SHAs are rejected', () => {
  assert.throws(() => resolveExpectedRuntimeSha({ liveSha: 'development', targetSha: MAIN, liveIsAncestorOfTarget: true, changedPaths: [] }), /exact commit/);
});

test('unknown paths inside the build root count as runtime', () => {
  assert.deepEqual(
    runtimeRelevantPaths(['story-engine/package-lock.json', 'story-engine/.dockerignore', 'story-engine/lib/x.js', 'story-engine/README.md', 'README.md']),
    ['story-engine/package-lock.json', 'story-engine/.dockerignore', 'story-engine/lib/x.js']
  );
});
