// Resolves which Railway release the front-door proof must observe.
//
// Railway does not redeploy for commits that only touch the Cloudflare edge,
// tests or CI, and it publishes no deployment status we can read. A proof that
// demands "live SHA == latest main" therefore fails on every edge-only commit
// even when the running code is byte-identical. This module replaces that
// assumption with evidence: the live SHA is accepted only when it is an
// ancestor of the target AND no runtime-relevant file differs between them.
// Anything not proven edge/test/docs-only counts as runtime (fail closed).

const SHA = /^[0-9a-f]{40}$/;

// Paths relative to the repo root. Only these are proven to not change what
// the Railway container (root dir story-engine/, see .dockerignore) executes.
const NON_RUNTIME = [
  /^(?!story-engine\/)/, // outside the Railway build root
  /^story-engine\/cloudflare-frontdoor\//, // edge Worker, never run by node
  /^story-engine\/wrangler\.jsonc$/,
  /^story-engine\/test\//,
  /^story-engine\/e2e\//,
  /^story-engine\/playwright[^/]*\.js$/,
  /^story-engine\/artifacts\//,
  /^story-engine\/[^/]*\.md$/
];

export function runtimeRelevantPaths(paths) {
  return paths.filter((path) => path && !NON_RUNTIME.some((rule) => rule.test(path)));
}

export function resolveExpectedRuntimeSha({ liveSha, targetSha, liveIsAncestorOfTarget, changedPaths }) {
  if (!SHA.test(liveSha || '')) throw new Error(`Live runtime SHA is not an exact commit: ${liveSha}`);
  if (!SHA.test(targetSha || '')) throw new Error(`Target SHA is not an exact commit: ${targetSha}`);
  if (liveSha === targetSha) return { expected: liveSha, equivalence: 'exact', undeployed: [] };
  if (!liveIsAncestorOfTarget) {
    throw new Error(`Live runtime ${liveSha} is not an ancestor of target ${targetSha}; Railway is serving unknown code.`);
  }
  const undeployed = runtimeRelevantPaths(changedPaths);
  if (undeployed.length) {
    throw new Error(`Railway at ${liveSha} is missing runtime changes from ${targetSha}: ${undeployed.join(', ')}`);
  }
  return { expected: liveSha, equivalence: 'runtime-identical', undeployed };
}
