import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupabaseCompanionTarget, appendSupabaseCompanionRequest } from '../lib/supabaseCompanionTransport.js';

const ref = 'tarnmxcjpvaxapnjnesf';
const env = {
  SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-jwt',
  STORYENGINE_SUPABASE_PROJECT_REF: ref,
};

test('disabled telemetry never writes to Supabase', async () => {
  let called = false;
  const ok = await appendSupabaseCompanionRequest({ id: 'synthetic' }, { env: {}, fetchImpl: async () => { called = true; } });
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('incomplete or mismatched configurations reject before any network call', async () => {
  for (const config of [
    { SUPABASE_URL: env.SUPABASE_URL },
    { ...env, SUPABASE_URL: 'https://iuxworqsqnyilbxrfctv.supabase.co' },
    { ...env, SUPABASE_URL: `http://${ref}.supabase.co` },
    { ...env, SUPABASE_URL: `${env.SUPABASE_URL}/rest/v1` },
    { ...env, SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_fake' },
  ]) {
    await assert.rejects(() => appendSupabaseCompanionRequest({ id: 'synthetic' }, {
      env: config,
      fetchImpl: () => { throw new Error('network should not be called'); },
    }));
  }
});

test('legacy server key writes only to exact project and only the companion table', async () => {
  let observed;
  const row = { id: 'synthetic', tenant_id: 'test-tenant' };
  const ok = await appendSupabaseCompanionRequest(row, {
    env,
    fetchImpl: async (url, options) => { observed = { url, options }; return { ok: true, status: 201 }; },
  });
  assert.equal(ok, true);
  assert.equal(observed.url, `https://${ref}.supabase.co/rest/v1/companion_requests`);
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(observed.options.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.deepEqual(JSON.parse(observed.options.body), row);
  assert.ok(observed.options.signal);
});

test('opaque server secret uses apikey but is not misused as a bearer JWT', async () => {
  let observed;
  await appendSupabaseCompanionRequest({ id: 'synthetic' }, {
    env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic' },
    fetchImpl: async (_url, options) => { observed = options.headers; return { ok: true, status: 201 }; },
  });
  assert.equal(observed.apikey, 'sb_secret_synthetic');
  assert.equal(observed.Authorization, undefined);
});

test('failed writes never echo response body or key', async () => {
  await assert.rejects(
    () => appendSupabaseCompanionRequest({ id: 'synthetic' }, {
      env,
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'secret material' }),
    }),
    error => error.message === 'StoryEngine Supabase companion insert returned HTTP 403',
  );
});
