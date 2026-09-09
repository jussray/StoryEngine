import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const proofWorkflow = readFileSync(
  join(__dirname, '..', '..', '.github', 'workflows', 'story-engine-production-proof.yml'),
  'utf8'
);
const signalWorkflow = readFileSync(
  join(__dirname, '..', '..', '.github', 'workflows', 'story-engine-production-signal.yml'),
  'utf8'
);
const l99CiWorkflow = readFileSync(
  join(__dirname, '..', '..', '.github', 'workflows', 'l99-story-engine.yml'),
  'utf8'
);

function jobPrefix(source, jobName) {
  const marker = `  ${jobName}:`;
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `${jobName} must exist`);
  const remainder = source.slice(index + marker.length);
  const nextJobOffset = remainder.search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJobOffset === -1
    ? source.slice(index)
    : source.slice(index, index + marker.length + nextJobOffset);
}

test('deployment status and manual recovery terminate in a secret-free signal workflow', () => {
  assert.match(signalWorkflow, /\non:\s*\n\s+deployment_status:/);
  assert.match(signalWorkflow, /workflow_dispatch:/);
  assert.ok(signalWorkflow.includes("trust: 'untrusted-input'"));
  assert.ok(signalWorkflow.includes('name: storyengine-production-signal-${{ github.run_attempt }}'));
  assert.doesNotMatch(signalWorkflow, /environment:\s*[\s\S]*name:\s+production/);
  assert.doesNotMatch(signalWorkflow, /STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY/);
  assert.doesNotMatch(signalWorkflow, /STORYENGINE_PRODUCTION_SCOPED_API_KEY/);
  assert.doesNotMatch(signalWorkflow, /STORYENGINE_PRODUCTION_ORIGIN/);
});

test('secret-bearing proof is sourced only through workflow_run from the named signal workflow', () => {
  assert.match(proofWorkflow, /\non:\s*\n\s+workflow_run:/);
  assert.ok(proofWorkflow.includes('- StoryEngine Production Signal'));
  assert.ok(proofWorkflow.includes('- completed'));
  assert.ok(proofWorkflow.includes('name: storyengine-production-signal-${{ github.event.workflow_run.run_attempt }}'));
  assert.doesNotMatch(proofWorkflow, /\n\s+deployment_status:/);
  assert.doesNotMatch(proofWorkflow, /\n\s+workflow_dispatch:/);
});

test('all production proofs serialize across signal runs without cancellation', () => {
  assert.match(
    proofWorkflow,
    /concurrency:\s*\n\s+group:\s+storyengine-production-proof-production\s*\n\s+cancel-in-progress:\s+false/
  );
  assert.doesNotMatch(proofWorkflow, /group:\s*["']?storyengine-production-proof-\$\{\{\s*github\.event\.workflow_run\.id/);
});

test('trusted authorize job validates untrusted signal before production environment exists', () => {
  const authorize = jobPrefix(proofWorkflow, 'authorize-signal');
  assert.ok(authorize.includes('ref: main'));
  assert.ok(authorize.includes('storyengine-production-signal-${{ github.event.workflow_run.run_attempt }}'));
  assert.ok(authorize.includes("signal.trust !== 'untrusted-input'"));
  assert.ok(authorize.includes('signal run identity mismatch'));
  assert.ok(authorize.includes('/deployments/${deploymentId}'));
  assert.ok(authorize.includes('/statuses/${deploymentStatusId}'));
  assert.ok(authorize.includes("status.state !== 'success'"));
  assert.ok(authorize.includes("deployment.environment || '').toLowerCase() !== 'production'"));
  assert.ok(authorize.includes('deployment SHA does not match signal release SHA'));
  assert.ok(authorize.includes('manual production proof is repository-owner only'));
  assert.ok(authorize.includes('git merge-base --is-ancestor "$release_sha" origin/main'));
  assert.doesNotMatch(authorize, /environment:\s*[\s\S]*name:\s+production/);
  assert.doesNotMatch(authorize, /STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY/);
  assert.doesNotMatch(authorize, /STORYENGINE_PRODUCTION_SCOPED_API_KEY/);
});

test('deployment authorization accepts only Railway-created production success receipts', () => {
  const authorize = jobPrefix(proofWorkflow, 'authorize-signal');
  assert.ok(authorize.includes('status.creator?.login'));
  assert.ok(authorize.includes('status.performed_via_github_app?.slug'));
  assert.ok(authorize.includes("statusCreator === 'railway-app[bot]'"));
  assert.ok(authorize.includes("statusAppSlug === 'railway-app'"));
  assert.ok(authorize.includes('deployment status did not originate from Railway App'));
});

test('deployment authorization rejects stale, rerun, and cross-branch receipts', () => {
  const authorize = jobPrefix(proofWorkflow, 'authorize-signal');
  assert.ok(authorize.includes('TRIGGERING_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}'));
  assert.ok(authorize.includes('TRIGGERING_HEAD_BRANCH: ${{ github.event.workflow_run.head_branch }}'));
  assert.ok(authorize.includes('TRIGGERING_RUN_ATTEMPT: ${{ github.event.workflow_run.run_attempt }}'));
  assert.ok(authorize.includes('TRIGGERING_CURRENT_ACTOR: ${{ github.event.workflow_run.triggering_actor.login }}'));
  assert.ok(authorize.includes("String(signal.source_run_attempt || '') !== triggeringRunAttempt"));
  assert.ok(authorize.includes('signal run attempt mismatch'));
  assert.ok(authorize.includes("Number(triggeringRunAttempt) > 1 && triggeringCurrentActor !== owner"));
  assert.ok(authorize.includes('production signal reruns are repository-owner only'));
  assert.ok(authorize.includes('signal.observed_at'));
  assert.ok(authorize.includes('authorizationTime = Date.now()'));
  assert.ok(authorize.includes('production signal is stale at authorization time'));
  assert.ok(authorize.includes("triggeringHeadBranch !== 'main'"));
  assert.ok(authorize.includes('triggeringHeadSha !== releaseSha'));
  assert.ok(authorize.includes('deployment signal SHA does not match triggering workflow head SHA'));
  assert.ok(authorize.includes('statusCreatedAt'));
  assert.ok(authorize.includes('15 * 60 * 1000'));
  assert.ok(authorize.includes('deployment status is stale at authorization time'));
  assert.doesNotMatch(authorize, /TRIGGERING_RUN_CREATED_AT/);
});

test('manual recovery authorizes only the current repository-owner initiator', () => {
  const authorize = jobPrefix(proofWorkflow, 'authorize-signal');
  assert.ok(authorize.includes("if (triggeringCurrentActor !== owner)"));
  assert.ok(authorize.includes('manual production proof is repository-owner only'));
  assert.ok(authorize.includes('triggering_actor: triggeringCurrentActor'));
  assert.ok(authorize.includes('triggering_run_attempt: triggeringRunAttempt'));
});

test('production environment is attached only after authorized signal output', () => {
  assert.ok(proofWorkflow.includes('needs: authorize-signal'));
  assert.ok(proofWorkflow.includes("if: ${{ needs.authorize-signal.outputs.authorized == 'true' }}"));
  assert.match(proofWorkflow, /verify-production:[\s\S]*environment:\s*[\s\S]*name:\s+production[\s\S]*deployment:\s+false/);
  const authorizeIndex = proofWorkflow.indexOf('authorize-signal:');
  const verifyIndex = proofWorkflow.indexOf('verify-production:');
  const environmentIndex = proofWorkflow.indexOf('name: production', verifyIndex);
  assert.ok(authorizeIndex >= 0 && verifyIndex > authorizeIndex && environmentIndex > verifyIndex);
});

test('release code is checked out only after exact SHA and main ancestry revalidation', () => {
  assert.ok(proofWorkflow.includes('[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]'));
  assert.ok(proofWorkflow.includes('git merge-base --is-ancestor "$EXPECTED_RELEASE_SHA" origin/main'));
  assert.ok(proofWorkflow.includes('git checkout --detach "$EXPECTED_RELEASE_SHA"'));
  assert.ok(proofWorkflow.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_RELEASE_SHA"'));
  const ancestryIndex = proofWorkflow.indexOf('git merge-base --is-ancestor "$EXPECTED_RELEASE_SHA" origin/main');
  const checkoutIndex = proofWorkflow.indexOf('git checkout --detach "$EXPECTED_RELEASE_SHA"');
  assert.ok(ancestryIndex >= 0 && checkoutIndex > ancestryIndex);
});

test('production origin remains independently authorized before runtime proof', () => {
  assert.ok(
    proofWorkflow.includes("STORYENGINE_AUTHORIZED_PRODUCTION_ORIGIN: ${{ vars.STORYENGINE_PRODUCTION_ORIGIN || secrets.STORYENGINE_PRODUCTION_ORIGIN }}")
  );
  assert.ok(proofWorkflow.includes('evaluateProductionOriginAuthority('));
  assert.ok(proofWorkflow.includes('missing-independent-origin-authority'));
  assert.ok(proofWorkflow.includes('production-origin-authority-rejected'));
});

test('production proof validates Railway-native release and persistent-volume continuity', () => {
  assert.ok(proofWorkflow.includes("identity.release_sha_source !== 'railway-git'"));
  assert.ok(proofWorkflow.includes("identity.runtime_mode !== 'production'"));
  assert.ok(proofWorkflow.includes("identity.state_backend !== 'sqlite'"));
  assert.ok(proofWorkflow.includes("identity.persistence_contract !== 'explicit-mounted-path'"));
  assert.ok(proofWorkflow.includes('persistence_witness is missing or invalid'));
  assert.ok(proofWorkflow.includes('persistent storage witness changed before credentialed browser proof'));
  assert.ok(proofWorkflow.includes('persistent storage witness changed during browser proof'));
  assert.ok(proofWorkflow.includes('provider-runtime-identity-mismatch'));
  assert.ok(proofWorkflow.includes('provider-runtime-unreachable'));
});

test('production proof polls bounded runtime convergence and classifies the latest endpoint evidence', () => {
  assert.ok(proofWorkflow.includes('Promise.allSettled(['));
  assert.ok(proofWorkflow.includes('for (let attempt = 1; attempt <= 12; attempt += 1)'));
  assert.ok(proofWorkflow.includes('await delay(5_000)'));
  assert.ok(proofWorkflow.includes('class ReachableEndpointError extends Error'));
  assert.ok(proofWorkflow.includes('this.reachable = true'));
  assert.ok(proofWorkflow.includes('const endpointReached = result =>'));
  assert.ok(proofWorkflow.includes('result.reason.reachable === true'));
  assert.ok(proofWorkflow.includes('endpoint_reachability'));
  assert.ok(proofWorkflow.includes('lastObservation = lastReachable'));
  assert.ok(proofWorkflow.includes("lastReachable ? 'provider-runtime-identity-mismatch' : 'provider-runtime-unreachable'"));
  assert.ok(proofWorkflow.includes('bounded verification window'));
});

test('HTTP response headers establish reachability before body parsing can fail', () => {
  const fetchIndex = proofWorkflow.indexOf('const response = await fetch(`${origin}${path}`');
  const bodyReadIndex = proofWorkflow.indexOf('text = await response.text()', fetchIndex);
  const bodyFailureIndex = proofWorkflow.indexOf('response body read failed', fetchIndex);
  assert.ok(fetchIndex >= 0, 'runtime probe must fetch the endpoint');
  assert.ok(bodyReadIndex > fetchIndex, 'body reading must occur after an HTTP response exists');
  assert.ok(bodyFailureIndex > bodyReadIndex, 'body-read failure must be converted into reachable evidence');
  assert.ok(proofWorkflow.includes('throw new ReachableEndpointError(`${path} response body read failed: ${detail}`'));
  assert.ok(proofWorkflow.includes('{ status: response.status }'));
});

test('browser secrets remain step-scoped inside the trusted production job', () => {
  assert.ok(proofWorkflow.includes('PLAYWRIGHT_API_KEY: ${{ secrets.STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY }}'));
  assert.ok(proofWorkflow.includes('PLAYWRIGHT_SCOPED_API_KEY: ${{ secrets.STORYENGINE_PRODUCTION_SCOPED_API_KEY }}'));
  assert.ok(proofWorkflow.includes('Revalidate authorized runtime immediately before credentialed browser proof'));
  const jobStart = proofWorkflow.indexOf('  verify-production:');
  const stepsStart = proofWorkflow.indexOf('\n    steps:', jobStart);
  assert.ok(jobStart >= 0 && stepsStart > jobStart);
  const jobHeader = proofWorkflow.slice(jobStart, stepsStart);
  assert.doesNotMatch(jobHeader, /STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY/);
  assert.doesNotMatch(jobHeader, /STORYENGINE_PRODUCTION_SCOPED_API_KEY/);
});

test('verified v1 receipt preserves historical compatibility while adding deployment metadata', () => {
  assert.ok(proofWorkflow.includes("schema: 'juss/storyengine-production-proof@v1'"));
  assert.ok(proofWorkflow.includes('trigger_sha: process.env.PROOF_TRIGGER_SHA || expected'));
  assert.ok(proofWorkflow.includes('origin_authority_mode: process.env.ORIGIN_AUTHORITY_MODE || null'));
  assert.ok(proofWorkflow.includes('verified_at: verifiedAt'));
  assert.ok(proofWorkflow.includes('runtime_identity: identity'));
  assert.ok(proofWorkflow.includes("playwright: 'passed'"));
  assert.ok(proofWorkflow.includes('github_deployment_id: process.env.GITHUB_DEPLOYMENT_ID || null'));
  assert.ok(proofWorkflow.includes('signal_mode: process.env.SIGNAL_MODE || null'));
});

test('blocked v1 receipt preserves historical correlation fields and reason contract', () => {
  assert.ok(proofWorkflow.includes("schema: 'juss/storyengine-production-proof-blocked@v1'"));
  assert.ok(proofWorkflow.includes("reason: 'provider-release-not-converged'"));
  assert.ok(proofWorkflow.includes('reason_detail: reasonDetail'));
  assert.ok(proofWorkflow.includes('trigger_sha: triggerSha'));
  assert.ok(proofWorkflow.includes('production_origin: origin'));
  assert.ok(proofWorkflow.includes('event_name: process.env.GITHUB_EVENT_NAME || null'));
  assert.ok(proofWorkflow.includes('last_observation: lastObservation'));
});

test('blocked and verified states retain machine-readable and browser evidence', () => {
  assert.ok(proofWorkflow.includes('production-proof-blocked.json'));
  assert.ok(proofWorkflow.includes('production-runtime-before.json'));
  assert.ok(proofWorkflow.includes('production-proof-summary.json'));
  assert.ok(proofWorkflow.includes('github_deployment_id'));
  assert.ok(proofWorkflow.includes('actions/upload-artifact@v4'));
  assert.ok(proofWorkflow.includes('story-engine/playwright-report/'));
  assert.ok(proofWorkflow.includes('story-engine/test-results/'));
  assert.ok(proofWorkflow.includes('${{ github.run_attempt }}'));
  assert.ok(proofWorkflow.includes('retention-days: 90'));
});

test('L99 CI watches both sides of the trusted production handoff', () => {
  const proofMatches = l99CiWorkflow.match(/\.github\/workflows\/story-engine-production-proof\.yml/g) || [];
  const signalMatches = l99CiWorkflow.match(/\.github\/workflows\/story-engine-production-signal\.yml/g) || [];
  assert.equal(proofMatches.length, 2, 'production proof workflow must be watched on push and pull_request');
  assert.equal(signalMatches.length, 2, 'production signal workflow must be watched on push and pull_request');
});
