import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {aggregateTestLedger, buildTestLedger, mapCheckState, selectLatestChecks} from '../scripts/control-room-test-ledger.mjs';

const SHA = '0b97f2a8a0d310c49c013a328ae61c97ddbc9bad';
const workflow = readFileSync(new URL('../.github/workflows/control-room-test-ledger.yml', import.meta.url), 'utf8');
const run = (overrides = {}) => ({id: 1, name: 'Promotion gates', status: 'completed', conclusion: 'success', head_sha: SHA, started_at: '2026-08-04T20:00:00Z', completed_at: '2026-08-04T20:01:00Z', details_url: 'https://github.com/jussray/StoryEngine/actions/runs/1', app: {slug: 'github-actions'}, ...overrides});

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

test('builds sanitized exact-SHA evidence', () => {
  const ledger = buildTestLedger({repository: 'jussray/StoryEngine', sha: SHA, branch: 'main', runId: '1', checks: selectLatestChecks([run()], SHA)});
  assert.equal(ledger.commitSha, SHA);
  assert.equal(ledger.source.includesAllDiscoveredChecks, true);
  assert.equal(JSON.stringify(ledger).includes('token'), false);
});

test('keeps the always-on ledger on one GitHub runner', () => {
  assert.equal((workflow.match(/\bruns-on:/g) ?? []).length, 1);
  assert.match(workflow, /CONTROL_ROOM_LEDGER_SELF_CHECK: Verify test-ledger contract/);
  assert.match(workflow, /name: Verify test-ledger contract/);
  assert.doesNotMatch(workflow, /publish-ledger:/);

  const contractIndex = workflow.indexOf('Run Control Room test-ledger contracts');
  const observeIndex = workflow.indexOf('Observe every exact-head check lane');
  assert.ok(contractIndex >= 0 && observeIndex > contractIndex);
});
