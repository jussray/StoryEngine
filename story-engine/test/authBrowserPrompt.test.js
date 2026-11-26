import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/l99_auth.js', import.meta.url), 'utf8');

function browserHarness() {
  const calls = [];
  const removed = [];
  let prompts = 0;
  const session = { authenticated: true, session: { role: 'creator' } };
  const window = {
    location: { origin: 'https://storyengine.jussco.company' },
    sessionStorage: { removeItem(key) { removed.push(key); } },
    localStorage: { removeItem(key) { removed.push(key); } },
    prompt() { prompts++; throw new Error('Native prompt must not appear'); },
    async fetch(url, init = {}) {
      calls.push({ url, init });
      if (url === '/api/auth/me') return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
      if (url === '/api/auth/session') return { ok: true, status: 201, json: async () => session };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  };
  runInNewContext(source, { window });
  return { window, calls, removed, get prompts() { return prompts; } };
}

test('public first load never asks for a bootstrap key or performs an auth handshake', () => {
  const browser = browserHarness();
  assert.equal(browser.prompts, 0);
  assert.equal(browser.calls.length, 0);
  assert.deepEqual(browser.removed, ['l99_api_key', 'l99_api_key']);
});

test('anonymous creator API request requires explicit sign-in without showing a native prompt', async () => {
  const browser = browserHarness();
  await assert.rejects(browser.window.fetch('/api/stories'), error =>
    error.code === 'AUTH_REQUIRED' && /sign in/i.test(error.message)
  );
  assert.equal(browser.prompts, 0);
  assert.deepEqual(browser.calls.map(call => call.url), ['/api/auth/me']);
});

test('explicit sign-in exchanges a key for a cookie session and resumes API access', async () => {
  const browser = browserHarness();
  const session = await browser.window.L99Auth.signInWithKey('example-private-key');
  assert.equal(session.authenticated, true);
  await browser.window.fetch('/api/stories');
  assert.deepEqual(browser.calls.map(call => call.url), ['/api/auth/session', '/api/stories']);
  assert.equal(browser.calls[0].init.headers['x-api-key'], 'example-private-key');
  assert.equal(browser.calls[1].init.credentials, 'same-origin');
  assert.equal(browser.calls[1].init.headers?.['x-api-key'], undefined);
  assert.equal(browser.prompts, 0);
});

test('missing key is rejected without a server request', async () => {
  const browser = browserHarness();
  await assert.rejects(browser.window.L99Auth.signInWithKey('   '), /Access key required/i);
  assert.equal(browser.calls.length, 0);
});
