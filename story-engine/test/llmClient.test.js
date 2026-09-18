import test from 'node:test';
import assert from 'node:assert/strict';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_WORKSPACE_ID',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_FAST_MODEL',
  'ANTHROPIC_DEEP_MODEL',
  'ANTHROPIC_VERSION',
  'LLM_ERROR_BODY_MAX_BYTES',
  'LLM_TIMEOUT_MS'
];

function captureEnv() {
  return Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] == null) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function freshClient() {
  return import(`../lib/llmClient.js?test=${Date.now()}-${Math.random()}`);
}

function anthropicEnvelope({ model = 'claude-sonnet-5', text = 'ok' } = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }]
  };
}

test('Anthropic request uses required headers and never serializes the API key', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  const secret = 'test-anthropic-key-that-must-not-leak';
  let observed;
  try {
    process.env.ANTHROPIC_API_KEY = secret;
    process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test123';
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_VERSION;
    globalThis.fetch = async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify(anthropicEnvelope()), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const { completeWithReceipt } = await freshClient();
    const receipt = await completeWithReceipt('hello', { provider: 'anthropic', maxTokens: 32, maxRetries: 0 });
    assert.equal(receipt.text, 'ok');
    assert.equal(observed.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(observed.init.headers['x-api-key'], secret);
    assert.equal(observed.init.headers['anthropic-version'], '2023-06-01');
    assert.equal(observed.init.headers['anthropic-workspace-id'], 'wrkspc_test123');
    const body = JSON.parse(observed.init.body);
    assert.equal(body.model, 'claude-sonnet-5');
    assert.equal(body.max_tokens, 32);
    assert.equal(Object.hasOwn(body, 'temperature'), false);
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(receipt.provenance.provider, 'anthropic');
    assert.equal(receipt.provenance.requested_model, 'claude-sonnet-5');
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Anthropic workspace header is omitted when no workspace id is configured', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  let observedHeaders;
  try {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.ANTHROPIC_WORKSPACE_ID;
    globalThis.fetch = async (_url, init) => {
      observedHeaders = init.headers;
      return new Response(JSON.stringify(anthropicEnvelope()), { status: 200 });
    };
    const { complete } = await freshClient();
    await complete('hello', { provider: 'anthropic', maxRetries: 0 });
    assert.equal('anthropic-workspace-id' in observedHeaders, false);
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Anthropic reflected error bodies are bounded and cannot leak the API key', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  const secret = 'test-reflected-anthropic-secret';
  try {
    process.env.ANTHROPIC_API_KEY = secret;
    process.env.LLM_ERROR_BODY_MAX_BYTES = '512';
    globalThis.fetch = async () => new Response(JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: `provider echoed ${secret} ${'x'.repeat(10000)}` }
    }), { status: 401 });

    const { completeWithReceipt, llmRoutingSnapshot } = await freshClient();
    assert.equal(llmRoutingSnapshot().error_body_max_bytes, 512);
    await assert.rejects(
      () => completeWithReceipt('hello', { provider: 'anthropic', maxRetries: 0 }),
      error => {
        assert.equal(String(error.message).includes(secret), false);
        assert.match(String(error.message), /status 401/);
        assert.ok(String(error.message).length < 300);
        return true;
      }
    );
    assert.equal(JSON.stringify(llmRoutingSnapshot()).includes(secret), false);
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Anthropic transport exceptions cannot leak the API key', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  const secret = 'test-transport-anthropic-secret';
  try {
    process.env.ANTHROPIC_API_KEY = secret;
    globalThis.fetch = async (_url, init) => {
      throw new Error(`transport diagnostics echoed ${init.headers['x-api-key']}`);
    };

    const { completeWithReceipt, llmRoutingSnapshot } = await freshClient();
    await assert.rejects(
      () => completeWithReceipt('hello', { provider: 'anthropic', maxRetries: 0 }),
      error => {
        assert.equal(String(error.message).includes(secret), false);
        assert.equal(error.code, 'llm_provider_request_failed');
        assert.match(String(error.message), /request failed for anthropic/);
        return true;
      }
    );
    assert.equal(JSON.stringify(llmRoutingSnapshot()).includes(secret), false);
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Anthropic success without the Messages API assistant envelope fails closed', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  try {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 'msg_test', content: [] }), { status: 200 });
    const { complete } = await freshClient();
    await assert.rejects(
      () => complete('hello', { provider: 'anthropic', maxRetries: 0 }),
      /valid Messages API assistant envelope/
    );
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Anthropic success with no text output fails closed', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  try {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    globalThis.fetch = async () => new Response(JSON.stringify({
      ...anthropicEnvelope(),
      content: [{ type: 'tool_use', id: 'tool_1' }]
    }), { status: 200 });
    const { complete } = await freshClient();
    await assert.rejects(
      () => complete('hello', { provider: 'anthropic', maxRetries: 0 }),
      /no text output/
    );
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Opus 5 request omits deprecated temperature even when supplied by a caller', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  let observedBody;
  try {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    globalThis.fetch = async (_url, init) => {
      observedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(anthropicEnvelope({ model: 'claude-opus-5' })), { status: 200 });
    };
    const { complete } = await freshClient();
    await complete('hello', {
      provider: 'anthropic',
      model: 'claude-opus-5',
      temperature: 0.2,
      maxRetries: 0
    });
    assert.equal(observedBody.model, 'claude-opus-5');
    assert.equal(Object.hasOwn(observedBody, 'temperature'), false);
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('invalid timeout configuration is bounded to a safe default', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  try {
    process.env.LLM_TIMEOUT_MS = 'not-a-number';
    const { llmRoutingSnapshot } = await freshClient();
    assert.equal(llmRoutingSnapshot().timeout_ms, 60000);
  } finally {
    restoreEnv(priorEnv);
  }
});

test('Anthropic deadline includes a stalled successful response body', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  try {
    process.env.ANTHROPIC_API_KEY = 'test-stalled-body-secret';
    globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
      }
    }), { status: 200 });
    const { completeWithReceipt, llmRoutingSnapshot } = await freshClient();
    await assert.rejects(completeWithReceipt('hello', { provider: 'anthropic', timeoutMs: 1000, maxRetries: 0 }),
      error => error.code === 'llm_timeout' && !error.message.includes('test-stalled-body-secret'));
    assert.equal(llmRoutingSnapshot().circuits.anthropic.successes, 0);
  } finally { globalThis.fetch = priorFetch; restoreEnv(priorEnv); }
});

test('Anthropic error type cannot reflect a credential into exceptions', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  const secret = 'test-key-reflected-as-error-type';
  try {
    process.env.ANTHROPIC_API_KEY = secret;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { type: secret } }), { status: 400 });
    const { completeWithReceipt } = await freshClient();
    await assert.rejects(completeWithReceipt('hello', { provider: 'anthropic', maxRetries: 0 }),
      error => error.status === 400 && !String(error).includes(secret));
  } finally { globalThis.fetch = priorFetch; restoreEnv(priorEnv); }
});
