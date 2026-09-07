import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  join(__dirname, '..', '..', '.github', 'workflows', 'story-engine-production-proof.yml'),
  'utf8'
);

function beforeSteps(source) {
  const marker = '\n    steps:';
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, 'production proof workflow must define job steps');
  return source.slice(0, index);
}

test('production proof requires independent GitHub environment origin authority', () => {
  assert.match(workflow, /environment:\s+production/);
  assert.ok(
    workflow.includes('STORYENGINE_AUTHORIZED_PRODUCTION_ORIGIN: ${{ vars.STORYENGINE_PRODUCTION_ORIGIN }}'),
    'production origin authority must come from the GitHub production environment'
  );
  assert.ok(
    workflow.includes('evaluateProductionOriginAuthority('),
    'source and environment origin must be compared before production credentials are used'
  );
  assert.ok(
    workflow.includes('missing-independent-origin-authority'),
    'missing independent authority must fail closed with a durable reason code'
  );
  assert.doesNotMatch(workflow, /optionalEnvironmentOrigin|SOURCE_BOUND|source-canonical-live-runtime-required/);
});

test('main proof supersedes stale main proof without cancelling manual historical proof', () => {
  assert.ok(
    workflow.includes('group: "storyengine-production-proof-${{ github.event_name == \'workflow_dispatch\' && inputs.release_sha || \'main\' }}"')
  );
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'push' }}"));
});

test('production proof keeps release identity and ancestry fail closed', () => {
  assert.ok(workflow.includes('git log --first-parent -1 --format=%H "$GITHUB_SHA" -- story-engine'));
  assert.ok(workflow.includes('git checkout --detach "$release_sha"'));
  assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_RELEASE_SHA"'));
  assert.ok(workflow.includes('git merge-base --is-ancestor "$EXPECTED_RELEASE_SHA" origin/main'));
  assert.ok(workflow.includes("redirect: 'error'"));
});

test('production browser secrets remain step-scoped and are not job-level environment values', () => {
  const prefix = beforeSteps(workflow);
  assert.doesNotMatch(prefix, /STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY/);
  assert.doesNotMatch(prefix, /STORYENGINE_PRODUCTION_SCOPED_API_KEY/);

  assert.ok(workflow.includes('PLAYWRIGHT_API_KEY: ${{ secrets.STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY }}'));
  assert.ok(workflow.includes('PLAYWRIGHT_SCOPED_API_KEY: ${{ secrets.STORYENGINE_PRODUCTION_SCOPED_API_KEY }}'));
  assert.ok(workflow.includes('Revalidate authorized runtime immediately before credentialed browser proof'));
});

test('blocked and verified production proof states retain machine-readable evidence', () => {
  assert.ok(workflow.includes('production-proof-blocked.json'));
  assert.ok(workflow.includes('production-runtime-before.json'));
  assert.ok(workflow.includes('production-proof-summary.json'));
  assert.ok(workflow.includes('actions/upload-artifact@v4'));
  assert.ok(workflow.includes('${{ github.run_attempt }}'));
  assert.ok(workflow.includes('retention-days: 90'));
});
