import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import worker, { rateLimitKey } from '../cloudflare-frontdoor/worker.js';

const ORIGINAL_FETCH = globalThis.fetch;

function allowLimiter(onKey = () => {}) {
  return {
    async limit({ key }) {
      onKey(key);
      return { success: true };
    }
  };
}

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

test('fails closed when an API request has no rate-limit binding', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('unexpected');
  };

  const response = await worker.fetch(new Request('https://storyengine.example/api/auth/me'), {
    STORYENGINE_RUNTIME_ORIGIN: 'https://runtime.storyengine.example'
  });
  assert.equal(response.status, 503);
  assert.equal(called, false);
  assert.equal(response.headers.get('x-storyengine-edge'), 'rate-limit-unavailable');
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
    STORYENGINE_RUNTIME_ORIGIN: 'https://runtime.storyengine.example',
    STORYENGINE_API_RATE_LIMITER: allowLimiter()
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.url, 'https://runtime.storyengine.example/api/auth/me?proof=1');
  assert.equal(payload.method, 'GET');
  assert.equal(payload.cookie, 'l99_session=receipt');
});

test('rate limit blocks API requests before the runtime is called', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('unexpected');
  };

  const response = await worker.fetch(new Request('https://storyengine.example/api/stories', {
    headers: { authorization: 'Bearer scoped-secret' }
  }), {
    STORYENGINE_RUNTIME_ORIGIN: 'https://runtime.storyengine.example',
    STORYENGINE_API_RATE_LIMITER: {
      async limit() {
        return { success: false };
      }
    }
  });

  assert.equal(response.status, 429);
  assert.equal(called, false);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('x-storyengine-edge'), 'rate-limited');
});

test('rate-limit keys are stable hashes and never expose session or auth material', async () => {
  const sessionRequest = new Request('https://storyengine.example/api/stories', {
    headers: { cookie: 'l99_session=session-secret; theme=dark' }
  });
  const authRequest = new Request('https://storyengine.example/api/stories', {
    headers: { authorization: 'Bearer auth-secret' }
  });

  const sessionKey = await rateLimitKey(sessionRequest);
  const repeatedSessionKey = await rateLimitKey(sessionRequest);
  const authKey = await rateLimitKey(authRequest);

  assert.equal(sessionKey, repeatedSessionKey);
  assert.match(sessionKey, /^[0-9a-f]{64}$/);
  assert.match(authKey, /^[0-9a-f]{64}$/);
  assert.notEqual(sessionKey, authKey);
  assert.equal(sessionKey.includes('session-secret'), false);
  assert.equal(authKey.includes('auth-secret'), false);
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

test('wrangler config deploys the front door only with a first-class API rate-limit binding', () => {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.name, 'storyengine');
  assert.equal(config.main, './cloudflare-frontdoor/worker.js');
  assert.equal(config.assets, undefined);
  assert.equal(config.site, undefined);
  assert.deepEqual(config.ratelimits, [{
    name: 'STORYENGINE_API_RATE_LIMITER',
    namespace_id: '1292370402',
    simple: { limit: 120, period: 60 }
  }]);
});

test('deployed runtime origin matches canonical production domain authority', () => {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  const authority = JSON.parse(readFileSync(new URL('../config/domain-authority.json', import.meta.url), 'utf8'));
  assert.equal(authority.mode, 'production');
  assert.equal(config.vars.STORYENGINE_RUNTIME_ORIGIN, authority.productionOrigin);
  assert.equal(new URL(authority.productionOrigin).protocol, 'https:');
  assert.equal(new URL(authority.productionOrigin).origin, authority.productionOrigin);
});

test('manual front-door proof defaults to runtime-equivalence mode', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/cloudflare-frontdoor-proof.yml', import.meta.url), 'utf8');
  assert.match(workflow, /expected_runtime_sha:\s*\n\s+description:.*\n\s+required: false\s*\n\s+type: string/);
  assert.match(workflow, /Resolve runtime-equivalent Railway release[\s\S]*?if: env\.EXPECTED_RUNTIME_SHA == ''/);
});
