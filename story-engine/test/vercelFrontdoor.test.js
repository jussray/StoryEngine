import assert from 'node:assert/strict';
import test from 'node:test';

import middleware from '../vercel-frontdoor/middleware.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_RUNTIME_ORIGIN = process.env.STORYENGINE_RUNTIME_ORIGIN;
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

function restoreEnv() {
  if (ORIGINAL_RUNTIME_ORIGIN === undefined) delete process.env.STORYENGINE_RUNTIME_ORIGIN;
  else process.env.STORYENGINE_RUNTIME_ORIGIN = ORIGINAL_RUNTIME_ORIGIN;

  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;

  globalThis.fetch = ORIGINAL_FETCH;
}

test.afterEach(restoreEnv);

test('fails closed when no runtime origin is configured', async () => {
  delete process.env.STORYENGINE_RUNTIME_ORIGIN;
  process.env.VERCEL_ENV = 'production';

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('unexpected');
  };

  const response = await middleware(new Request('https://storyengine.example/'));
  assert.equal(response.status, 503);
  assert.equal(called, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('proxies the complete path and session cookie to the L99 runtime', async () => {
  process.env.STORYENGINE_RUNTIME_ORIGIN = 'https://runtime.storyengine.example';
  process.env.VERCEL_ENV = 'production';

  globalThis.fetch = async request => new Response(JSON.stringify({
    url: request.url,
    method: request.method,
    cookie: request.headers.get('cookie')
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const request = new Request('https://storyengine.example/api/auth/me?proof=1', {
    headers: { cookie: 'l99_session=receipt' }
  });
  const response = await middleware(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.url, 'https://runtime.storyengine.example/api/auth/me?proof=1');
  assert.equal(payload.method, 'GET');
  assert.equal(payload.cookie, 'l99_session=receipt');
});

test('rejects insecure non-local production runtime origins', async () => {
  process.env.STORYENGINE_RUNTIME_ORIGIN = 'http://runtime.storyengine.example';
  process.env.VERCEL_ENV = 'production';

  const response = await middleware(new Request('https://storyengine.example/healthz'));
  assert.equal(response.status, 503);
});
