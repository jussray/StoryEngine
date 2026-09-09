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
const l99CiWorkflow = readFileSync(
  join(__dirname, '..', '..', '.github', 'workflows', 'l99-story-engine.yml'),
  'utf8'
);

function beforeSteps(source) {
  const marker = '\n    steps:';
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, 'production proof workflow must define job steps');
  return source.slice(0, index);
}

test('production proof requires independent GitHub environment origin authority without creating its own deployment', () => {
  assert.match(workflow, /environment:\s*[\s\S]*name:\s+production[\s\S]*deployment:\s+false/);
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

test('production proof runs after successful production deployment status instead of participating in provider CI gating', () => {
  assert.match(workflow, /\non:\s*\n\s+deployment_status:/);
  assert.ok(workflow.includes("github.event.deployment_status.state == 'success'"));
  assert.ok(workflow.includes("github.event.deployment.environment == 'production'"));
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /\n  push:\s*\n/);
});

test('new production deployment proof supersedes stale live proof without cancelling manual historical proof', () => {
  assert.ok(
    workflow.includes("group: \"storyengine-production-proof-${{ github.event_name == 'workflow_dispatch' && inputs.release_sha || 'production' }}\"")
  );
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'deployment_status' }}"));
});

test('production proof binds immutable release subject to provider deployment SHA or manual SHA', () => {
  assert.ok(workflow.includes('DEPLOYED_RELEASE_SHA: ${{ github.event.deployment.sha }}'));
  assert.ok(workflow.includes('release_sha="$DEPLOYED_RELEASE_SHA"'));
  assert.ok(workflow.includes('git checkout --detach "$release_sha"'));
  assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_RELEASE_SHA"'));
  assert.ok(workflow.includes('git merge-base --is-ancestor "$EXPECTED_RELEASE_SHA" origin/main'));
  assert.ok(workflow.includes("redirect: 'error'"));
});

test('production proof validates provider-native Railway identity and fails closed on runtime mismatch', () => {
  assert.ok(workflow.includes("identity.release_sha_source !== 'railway-git'"));
  assert.ok(workflow.includes("reason = last ? 'provider-runtime-identity-mismatch' : 'provider-runtime-unreachable'"));
  assert.ok(workflow.includes('Provider reported a successful production deployment'));
  assert.doesNotMatch(workflow, /provider-release-not-converged/);
  assert.doesNotMatch(workflow, /attempt <= 60/);
  assert.doesNotMatch(workflow, /delay\(10_000\)/);
});

test('production proof distinguishes transport reachability from later runtime validation failure', () => {
  assert.ok(workflow.includes('let reachedThisAttempt = false;'));
  assert.ok(workflow.includes('reachedThisAttempt = true;'));
  assert.ok(workflow.includes('if (!reachedThisAttempt) last = null;'));
  assert.doesNotMatch(workflow, /catch \(error\) \{\s*last = null;/);
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

test('L99 Story Engine CI watches production proof workflow contract changes', () => {
  const matches = l99CiWorkflow.match(/\.github\/workflows\/story-engine-production-proof\.yml/g) || [];
  assert.equal(matches.length, 2, 'production proof workflow must be watched by both push and pull_request CI paths');
});

test('blocked and verified production proof states retain machine-readable evidence', () => {
  assert.ok(workflow.includes('production-proof-blocked.json'));
  assert.ok(workflow.includes('provider-runtime-identity-mismatch'));
  assert.ok(workflow.includes('provider-runtime-unreachable'));
  assert.ok(workflow.includes('production-runtime-before.json'));
  assert.ok(workflow.includes('production-proof-summary.json'));
  assert.ok(workflow.includes('github_deployment_id'));
  assert.ok(workflow.includes('actions/upload-artifact@v4'));
  assert.ok(workflow.includes('${{ github.run_attempt }}'));
  assert.ok(workflow.includes('retention-days: 90'));
});
