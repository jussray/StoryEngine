import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'TEST_ANTHROPIC_TOKEN_MARKER_123456';
process.env.ANTHROPIC_API_KEY = SECRET;
process.env.LLM_MAX_RETRIES = '0';

const { complete, llmRoutingSnapshot } = await import('../lib/llmClient.js');

test('Anthropic failures redact configured API key from thrown errors and circuit receipts', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers['x-api-key'], SECRET);
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    return new Response(`provider echoed ${SECRET}`, { status: 400 });
  };

  try {
    await assert.rejects(
      complete('safe test', { provider: 'anthropic', maxRetries: 0, timeoutMs: 1000, maxTokens: 8 }),
      error => {
        assert.equal(error.status, 400);
        assert.doesNotMatch(error.message, new RegExp(SECRET));
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      }
    );

    const receipt = llmRoutingSnapshot().circuits.anthropic;
    assert.ok(receipt);
    assert.doesNotMatch(receipt.last_error, new RegExp(SECRET));
    assert.match(receipt.last_error, /\[REDACTED\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
