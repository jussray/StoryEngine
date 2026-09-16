import test from 'node:test';
import assert from 'node:assert/strict';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_WORKSPACE_ID',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_FAST_MODEL',
  'ANTHROPIC_DEEP_MODEL',
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

test('Anthropic request uses current default model, version header, optional workspace, and never serializes the key', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  const secret = 'sk-ant-test-secret-value';
  let observed;
  try {
    process.env.ANTHROPIC_API_KEY = secret;
    process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test123';
    delete process.env.ANTHROPIC_MODEL;
    globalThis.fetch = async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const { complete } = await freshClient();
    const result = await complete('hello', { provider: 'anthropic', maxTokens: 32, maxRetries: 0 });
    assert.equal(result, 'ok');
    assert.equal(observed.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(observed.init.headers['x-api-key'], secret);
    assert.equal(observed.init.headers['anthropic-version'], '2023-06-01');
    assert.equal(observed.init.headers['anthropic-workspace-id'], 'wrkspc_test123');
    const body = JSON.parse(observed.init.body);
    assert.equal(body.model, 'claude-sonnet-5');
    assert.equal(body.max_tokens, 32);
    assert.equal(JSON.stringify(body).includes(secret), false);
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
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    delete process.env.ANTHROPIC_WORKSPACE_ID;
    globalThis.fetch = async (_url, init) => {
      observedHeaders = init.headers;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
    };
    const { complete } = await freshClient();
    await complete('hello', { provider: 'anthropic', maxRetries: 0 });
    assert.equal('anthropic-workspace-id' in observedHeaders, false);
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('provider error bodies are bounded and reflected API keys are redacted', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  const secret = 'sk-ant-super-secret-reflection';
  try {
    process.env.ANTHROPIC_API_KEY = secret;
    process.env.LLM_ERROR_BODY_MAX_BYTES = '512';
    globalThis.fetch = async () => new Response(`provider echoed ${secret} ${'x'.repeat(10000)}`, { status: 500 });
    const { complete, llmRoutingSnapshot } = await freshClient();
    assert.equal(llmRoutingSnapshot().error_body_max_bytes, 512);
    await assert.rejects(
      () => complete('hello', { provider: 'anthropic', maxRetries: 0 }),
      error => {
        assert.equal(error.message.includes(secret), false);
        assert.match(error.message, /\[REDACTED\]/);
        assert.ok(error.message.length < 800);
        return true;
      }
    );
  } finally {
    globalThis.fetch = priorFetch;
    restoreEnv(priorEnv);
  }
});

test('Anthropic success without a content array fails closed', { concurrency: false }, async () => {
  const priorEnv = captureEnv();
  const priorFetch = globalThis.fetch;
  try {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 });
    const { complete } = await freshClient();
    await assert.rejects(
      () => complete('hello', { provider: 'anthropic', maxRetries: 0 }),
      /missing the content array/
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
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'tool_1' }] }), { status: 200 });
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
