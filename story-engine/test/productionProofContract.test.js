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
  const nextJob = source.indexOf('\n  ', index + marker.length);
  return nextJob === -1 ? source.slice(index) : source.slice(index, nextJob);
}

test('deployment status and manual recovery terminate in a secret-free signal workflow', () => {
  assert.match(signalWorkflow, /\non:\s*\n\s+deployment_status:/);
  assert.match(signalWorkflow, /workflow_dispatch:/);
  assert.ok(signalWorkflow.includes("trust: 'untrusted-input'"));
  assert.ok(signalWorkflow.includes('storyengine-production-signal'));
  assert.doesNotMatch(signalWorkflow, /environment:\s*[\s\S]*name:\s+production/);
  assert.doesNotMatch(signalWorkflow, /STORYENGINE_PRODUCTION_PLAYWRIGHT_API_KEY/);
  assert.doesNotMatch(signalWorkflow, /STORYENGINE_PRODUCTION_SCOPED_API_KEY/);
  assert.doesNotMatch(signalWorkflow, /STORYENGINE_PRODUCTION_ORIGIN/);
});

test('secret-bearing proof is sourced only through workflow_run from the named signal workflow', () => {
  assert.match(proofWorkflow, /\non:\s*\n\s+workflow_run:/);
  assert.ok(proofWorkflow.includes('- StoryEngine Production Signal'));
  assert.ok(proofWorkflow.includes('- completed'));
  assert.doesNotMatch(proofWorkflow, /\n\s+deployment_status:/);
  assert.doesNotMatch(proofWorkflow, /\n\s+workflow_dispatch:/);
});

test('trusted authorize job validates untrusted signal before production environment exists', () => {
  const authorize = jobPrefix(proofWorkflow, 'authorize-signal');
  assert.ok(authorize.includes('ref: main'));
  assert.ok(authorize.includes('storyengine-production-signal'));
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

test('blocked and verified states retain machine-readable evidence', () => {
  assert.ok(proofWorkflow.includes('production-proof-blocked.json'));
  assert.ok(proofWorkflow.includes('production-runtime-before.json'));
  assert.ok(proofWorkflow.includes('production-proof-summary.json'));
  assert.ok(proofWorkflow.includes('github_deployment_id'));
  assert.ok(proofWorkflow.includes('actions/upload-artifact@v4'));
  assert.ok(proofWorkflow.includes('${{ github.run_attempt }}'));
  assert.ok(proofWorkflow.includes('retention-days: 90'));
});

test('L99 CI watches both sides of the trusted production handoff', () => {
  const proofMatches = l99CiWorkflow.match(/\.github\/workflows\/story-engine-production-proof\.yml/g) || [];
  const signalMatches = l99CiWorkflow.match(/\.github\/workflows\/story-engine-production-signal\.yml/g) || [];
  assert.equal(proofMatches.length, 2, 'production proof workflow must be watched on push and pull_request');
  assert.equal(signalMatches.length, 2, 'production signal workflow must be watched on push and pull_request');
});
