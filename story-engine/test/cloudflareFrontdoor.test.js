import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import worker from '../cloudflare-frontdoor/worker.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('fails closed when no runtime origin is configured', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('unexpected');
  };

  const response = await worker.fetch(new Request('https://storyengine.example/'), {});
  assert.equal(response.status, 503);
  assert.equal(called, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-storyengine-edge'), 'runtime-unavailable');
});

test('proxies the complete path and session cookie to the L99 runtime', async () => {
  globalThis.fetch = async request => new Response(JSON.stringify({
    url: request.url,
    method: request.method,
    cookie: request.headers.get('cookie')
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const request = new Request('https://storyengine.example/api/auth/me?proof=1', {
    headers: { cookie: 'l99_session=receipt' }
  });
  const response = await worker.fetch(request, {
    STORYENGINE_RUNTIME_ORIGIN: 'https://runtime.storyengine.example'
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.url, 'https://runtime.storyengine.example/api/auth/me?proof=1');
  assert.equal(payload.method, 'GET');
  assert.equal(payload.cookie, 'l99_session=receipt');
});

test('rejects insecure, credentialed, or pathed runtime origins', async () => {
  for (const origin of [
    'http://runtime.storyengine.example',
    'https://user:pass@runtime.storyengine.example',
    'https://runtime.storyengine.example/app',
    'not a url'
  ]) {
    const response = await worker.fetch(new Request('https://storyengine.example/healthz'), {
      STORYENGINE_RUNTIME_ORIGIN: origin
    });
    assert.equal(response.status, 503, origin);
  }
});

test('returns 502 when the runtime cannot be reached', async () => {
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  const response = await worker.fetch(new Request('https://storyengine.example/'), {
    STORYENGINE_RUNTIME_ORIGIN: 'https://runtime.storyengine.example'
  });
  assert.equal(response.status, 502);
});

test('wrangler config deploys the front door only, never static operator pages', () => {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.name, 'storyengine');
  assert.equal(config.main, './cloudflare-frontdoor/worker.js');
  assert.equal(config.assets, undefined);
  assert.equal(config.site, undefined);
});
