import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
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

test('Anthropic live smoke is trusted-main-only and waits for source tests', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes('needs: test'));
  assert.ok(job.includes("if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"));
  assert.match(job, /environment:\s*\n\s+name:\s+production\s*\n\s+deployment:\s+false/);
  assert.ok(job.includes('ref: ${{ github.sha }}'));
  assert.ok(job.includes('test "$actual" = "${GITHUB_SHA}"'));
});

test('Anthropic secret is step-scoped and never part of the PR test job', () => {
  const smoke = jobPrefix(workflow, 'anthropic-live-smoke');
  const smokeSteps = smoke.indexOf('\n    steps:');
  assert.ok(smokeSteps > 0);
  assert.doesNotMatch(smoke.slice(0, smokeSteps), /ANTHROPIC_API_KEY/);
  assert.ok(smoke.includes('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}'));
  assert.ok(smoke.includes('ANTHROPIC_WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}'));

  const sourceTests = jobPrefix(workflow, 'test');
  assert.doesNotMatch(sourceTests, /ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\./);
});

test('live smoke uses the existing client and emits only sanitized provider provenance', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes("import { completeWithReceipt } from './lib/llmClient.js'"));
  assert.ok(job.includes("provider: 'anthropic'"));
  assert.ok(job.includes('maxRetries: 0'));
  assert.ok(job.includes('timeoutMs: 30_000'));
  assert.ok(job.includes('maxTokens: 1024'));
  assert.ok(job.includes("schema: 'juss/storyengine-anthropic-live-smoke@v1'"));
  assert.ok(job.includes("status: 'verified'"));
  assert.ok(job.includes('requested_model: receipt.provenance.requested_model || null'));
  assert.ok(job.includes('response_model: receipt.provenance.response_model || null'));
  assert.ok(job.includes('response_id: receipt.provenance.response_id || null'));
  assert.ok(job.includes('api_version: receipt.provenance.api_version || null'));
  assert.ok(job.includes('output_nonempty: true'));
  assert.doesNotMatch(job, /text:\s*receipt\.text/);
  assert.doesNotMatch(job, /console\.(log|error)\([^\n]*receipt\.text/);
});

test('failure diagnostics inspect the same bounded response clone and reduce it to whitelisted enums', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes("String(url) === 'https://api.anthropic.com/v1/messages'"));
  assert.ok(job.includes('readBoundedDiagnosticText(response.clone(), 4096)'));
  assert.ok(job.includes('provider_error_type: providerDiagnostic.type'));
  assert.ok(job.includes('provider_error_reason: providerDiagnostic.reason'));
  for (const reason of [
    'data_retention',
    'spending_limit',
    'max_tokens',
    'sampling_parameter',
    'thinking',
    'workspace',
    'model',
    'messages',
    'system'
  ]) {
    assert.ok(job.includes(`'${reason}'`), `missing safe diagnostic reason ${reason}`);
  }
  assert.doesNotMatch(job, /provider_error_message/);
  assert.doesNotMatch(job, /raw_body/);
  assert.doesNotMatch(job, /error_message/);
});

test('external provider availability is a receipted plugin blocker, not a false core failure', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes("architecture_contract: 'juss/self-sufficient-architecture@v1'"));
  assert.ok(job.includes("provider_role: 'plugin'"));
  assert.ok(job.includes("status: 'blocked'"));
  assert.ok(job.includes("blocker_reason: 'credential_unavailable'"));
  assert.ok(job.includes("diagnostic?.reason === 'spending_limit'"));
  assert.ok(job.includes("diagnostic?.reason === 'data_retention'"));
  assert.ok(job.includes("return 'provider_unavailable'"));
  assert.ok(job.includes("['llm_timeout', 'llm_provider_request_failed', 'llm_circuit_open']"));
  assert.ok(job.includes("status: blockerReason ? 'blocked' : 'failed'"));
});

test('integration defects still fail closed even when provider blockers are scoped', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes("code: 'provider_provenance_mismatch'"));
  assert.ok(job.includes("code: 'provider_empty_text'"));
  assert.ok(job.includes("status: blockerReason ? 'blocked' : 'failed'"));
  assert.ok(job.includes('process.exitCode = 1'));
});

test('failure receipt never serializes provider output or exception message', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes("'failed'"));
  assert.ok(job.includes('error_code: errorCode'));
  assert.ok(job.includes('http_status:'));
  assert.doesNotMatch(job, /message:\s*String\(error/);
  assert.doesNotMatch(job, /stack:/);
  assert.doesNotMatch(job, /body:/);
});

test('sanitized live receipt is retained as a separate artifact', () => {
  const job = jobPrefix(workflow, 'anthropic-live-smoke');
  assert.ok(job.includes('actions/upload-artifact@v4'));
  assert.ok(job.includes('name: anthropic-live-smoke-${{ github.run_attempt }}'));
  assert.ok(job.includes('story-engine/test-results/anthropic-live-smoke.json'));
  assert.ok(job.includes('if-no-files-found: warn'));
  assert.ok(job.includes('retention-days: 30'));
});
