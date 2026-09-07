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
    workflow.includes("STORYENGINE_AUTHORIZED_PRODUCTION_ORIGIN: ${{ vars.STORYENGINE_PRODUCTION_ORIGIN || secrets.STORYENGINE_PRODUCTION_ORIGIN }}"),
    'production origin authority must come from GitHub configuration outside application source'
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

test('production proof is post-CI and cannot participate in Railway Wait for CI deadlock', () => {
  assert.match(workflow, /workflow_run:\s*[\s\S]*workflows:\s*[\s\S]*- L99 Story Engine CI/);
  assert.match(workflow, /types:\s*[\s\S]*- completed/);
  assert.match(workflow, /branches:\s*[\s\S]*- main/);
  assert.ok(workflow.includes("github.event.workflow_run.conclusion == 'success'"));
  assert.doesNotMatch(workflow, /\n  push:\s*\n/);
});

test('new post-CI proof supersedes stale main proof without cancelling manual historical proof', () => {
  assert.ok(
    workflow.includes('group: "storyengine-production-proof-${{ github.event_name == \'workflow_dispatch\' && inputs.release_sha || \'main\' }}"')
  );
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'workflow_run' }}"));
});

test('production proof binds immutable release subject to upstream green CI head or manual SHA', () => {
  assert.ok(workflow.includes('UPSTREAM_RELEASE_SHA: ${{ github.event.workflow_run.head_sha }}'));
  assert.ok(workflow.includes('release_sha="$UPSTREAM_RELEASE_SHA"'));
  assert.ok(workflow.includes('git checkout --detach "$release_sha"'));
  assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_RELEASE_SHA"'));
  assert.ok(workflow.includes('git merge-base --is-ancestor "$EXPECTED_RELEASE_SHA" origin/main'));
  assert.ok(workflow.includes("redirect: 'error'"));
});

test('production proof enforces persistent volume witness continuity across browser mutation', () => {
  assert.ok(workflow.includes('EXPECTED_PERSISTENCE_WITNESS'));
  assert.ok(workflow.includes('persistence_witness is missing or invalid'));
  assert.ok(workflow.includes('persistent storage witness changed before credentialed browser proof'));
  assert.ok(workflow.includes('persistent storage witness changed during browser proof'));
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
  assert.ok(workflow.includes("reason: 'provider-release-not-converged'"));
  assert.ok(workflow.includes('production-runtime-before.json'));
  assert.ok(workflow.includes('production-proof-summary.json'));
  assert.ok(workflow.includes('actions/upload-artifact@v4'));
  assert.ok(workflow.includes('${{ github.run_attempt }}'));
  assert.ok(workflow.includes('retention-days: 90'));
});
