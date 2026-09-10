import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {aggregateTestLedger, buildTestLedger, classifyProviderHandoff, mapCheckState, selectLatestChecks} from '../scripts/control-room-test-ledger.mjs';

const SHA = '0b97f2a8a0d310c49c013a328ae61c97ddbc9bad';
const workflow = readFileSync(new URL('../.github/workflows/control-room-test-ledger.yml', import.meta.url), 'utf8');
const run = (overrides = {}) => ({id: 1, name: 'Promotion gates', status: 'completed', conclusion: 'success', head_sha: SHA, started_at: '2026-08-04T20:00:00Z', completed_at: '2026-08-04T20:01:00Z', details_url: 'https://github.com/jussray/StoryEngine/actions/runs/1', app: {slug: 'github-actions'}, ...overrides});
const railwayObservation = (state = 'success', overrides = {}) => ({
  deployment: {id: 7, sha: SHA, environment: 'production', creator: {login: 'railway-app[bot]'}},
  status: {id: 9, state, created_at: '2026-08-04T20:02:00Z', creator: {login: 'railway-app[bot]'}, performed_via_github_app: {slug: 'railway-app'}},
  ...overrides,
});

test('maps provider states without false green', () => {
  assert.equal(mapCheckState(run()), 'passed');
  assert.equal(mapCheckState(run({conclusion: 'skipped'})), 'skipped');
  assert.equal(mapCheckState(run({conclusion: 'failure'})), 'failed');
  assert.equal(mapCheckState(run({status: 'in_progress', conclusion: null})), 'running');
  assert.equal(mapCheckState(run({status: 'completed', conclusion: null})), 'unknown');
});

test('keeps every latest exact-head lane', () => {
  const checks = selectLatestChecks([
    run({id: 1, completed_at: '2026-08-04T20:01:00Z'}),
    run({id: 2, conclusion: 'failure', completed_at: '2026-08-04T20:02:00Z'}),
    run({id: 3, name: 'Story Video Engine Playwright'}),
    run({id: 4, name: 'Cloudflare Pages', app: {slug: 'cloudflare-pages'}}),
    run({id: 5, name: 'Verify test-ledger contract'}),
  ], SHA, 'Verify test-ledger contract');
  assert.deepEqual(checks.map((item) => item.name), ['Cloudflare Pages', 'Promotion gates', 'Story Video Engine Playwright']);
  assert.equal(checks.find((item) => item.name === 'Promotion gates')?.state, 'failed');
});

test('preserves aggregate states', () => {
  assert.equal(aggregateTestLedger([]).state, 'unknown');
  assert.equal(aggregateTestLedger([{state: 'passed'}]).state, 'passed');
  assert.equal(aggregateTestLedger([{state: 'skipped'}]).state, 'warning');
  assert.equal(aggregateTestLedger([{state: 'running'}]).state, 'pending');
  assert.equal(aggregateTestLedger([{state: 'failed'}]).state, 'failed');
});

test('classifies Railway production handoff without granting merge authority', () => {
  const observedAt = new Date('2026-08-04T20:03:00Z');
  const success = classifyProviderHandoff([railwayObservation()], SHA, observedAt);
  assert.equal(success.state, 'observed');
  assert.equal(success.providerState, 'success');
  assert.equal(success.authoritativeForMerge, false);
  assert.equal(success.deploymentId, '7');
  assert.equal(success.ageSeconds, 60);
  assert.equal(classifyProviderHandoff([railwayObservation('queued')], SHA, observedAt).state, 'pending');
  assert.equal(classifyProviderHandoff([railwayObservation('failure')], SHA, observedAt).state, 'failed');
});

test('ignores foreign or wrong-SHA deployment statuses', () => {
  const foreign = railwayObservation('success', {
    deployment: {id: 7, sha: SHA, environment: 'production', creator: {login: 'other-bot'}},
    status: {id: 9, state: 'success', created_at: '2026-08-04T20:02:00Z', creator: {login: 'other-bot'}},
  });
  const wrongSha = railwayObservation('success', {deployment: {id: 8, sha: 'f'.repeat(40), environment: 'production', creator: {login: 'railway-app[bot]'}}});
  assert.equal(classifyProviderHandoff([foreign, wrongSha], SHA, new Date('2026-08-04T20:03:00Z')).state, 'absent');
});

test('builds sanitized exact-SHA evidence with additive provider handoff', () => {
  const providerHandoff = classifyProviderHandoff([railwayObservation()], SHA, new Date('2026-08-04T20:03:00Z'));
  const ledger = buildTestLedger({repository: 'jussray/StoryEngine', sha: SHA, branch: 'main', runId: '1', checks: selectLatestChecks([run()], SHA), providerHandoff});
  assert.equal(ledger.commitSha, SHA);
  assert.equal(ledger.source.includesAllDiscoveredChecks, true);
  assert.equal(ledger.providerHandoff.state, 'observed');
  assert.equal(ledger.providerHandoff.authoritativeForMerge, false);
  assert.equal(JSON.stringify(ledger).includes('token'), false);
});

test('keeps the always-on ledger on one GitHub runner', () => {
  assert.equal((workflow.match(/\bruns-on:/g) ?? []).length, 1);
  assert.match(workflow, /deployments: read/);
  assert.match(workflow, /CONTROL_ROOM_LEDGER_SELF_CHECK: Verify test-ledger contract/);
  assert.match(workflow, /name: Verify test-ledger contract/);
  assert.doesNotMatch(workflow, /publish-ledger:/);
  const contractIndex = workflow.indexOf('Run Control Room test-ledger contracts');
  const observeIndex = workflow.indexOf('Observe every exact-head check lane');
  assert.ok(contractIndex >= 0 && observeIndex > contractIndex);
});
