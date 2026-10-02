// CI entry: prints EXPECTED_RUNTIME_SHA=<sha> for $GITHUB_ENV, or exits 1.
// Usage: node resolve-runtime-sha.js <targetSha>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveExpectedRuntimeSha } from './runtime-equivalence.js';

const targetSha = (process.argv[2] || '').trim().toLowerCase();
const { productionOrigin } = JSON.parse(readFileSync(
  new URL('../../config/domain-authority.json', import.meta.url), 'utf8'
));

const response = await fetch(`${productionOrigin}/runtime-identity`, { redirect: 'manual' });
if (response.status !== 200) {
  console.error(`runtime-identity returned ${response.status}`);
  process.exit(1);
}
const liveSha = String((await response.json()).release_sha || '').toLowerCase();

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
let liveIsAncestorOfTarget = false;
try {
  git('merge-base', '--is-ancestor', liveSha, targetSha);
  liveIsAncestorOfTarget = true;
} catch {}
const changedPaths = liveIsAncestorOfTarget && liveSha !== targetSha
  ? git('diff', '--name-only', liveSha, targetSha).split('\n').filter(Boolean)
  : [];

try {
  const result = resolveExpectedRuntimeSha({ liveSha, targetSha, liveIsAncestorOfTarget, changedPaths });
  console.error(`target=${targetSha} live=${liveSha} equivalence=${result.equivalence} changed=${changedPaths.length}`);
  console.log(`EXPECTED_RUNTIME_SHA=${result.expected}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
