import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const { productionOrigin } = JSON.parse(readFileSync(
  new URL('../../config/domain-authority.json', import.meta.url), 'utf8'
));

async function readJson(request, url) {
  const response = await request.get(url, { maxRedirects: 0 });
  expect(response.status(), url).toBe(200);
  return response.json();
}

test('health passes through the real Worker to the canonical runtime', async ({ request }, testInfo) => {
  const direct = await readJson(request, `${productionOrigin}/healthz`);
  const edge = await readJson(request, '/healthz');
  expect(direct.status).toBe('ok');
  expect(edge.status).toBe(direct.status);
  expect(edge.release_sha).toBe(direct.release_sha);
  await testInfo.attach('health.json', { body: JSON.stringify({ direct, edge }), contentType: 'application/json' });
});

test('runtime identity matches direct Railway and the expected deployed SHA', async ({ request }, testInfo) => {
  const expected = process.env.EXPECTED_RUNTIME_SHA || '';
  expect(expected, 'An exact deployed SHA is required; health alone is not release proof').toMatch(/^[0-9a-f]{40}$/);
  const direct = await readJson(request, `${productionOrigin}/runtime-identity`);
  const edge = await readJson(request, '/runtime-identity');
  await testInfo.attach('runtime-identity.json', { body: JSON.stringify({ expected, direct, edge }), contentType: 'application/json' });
  expect(edge).toEqual(direct);
  expect(edge.service).toBe('l99-story-engine');
  expect(edge.release_sha).toBe(expected);
  expect(edge.release_sha_source).toBe('railway-git');
  expect(edge.configured_release_sha_matches).not.toBe(false);
  expect(edge.runtime_mode).toBe('production');
  expect(edge.state_backend).toBe('sqlite');
  expect(edge.persistence_contract).toBe('explicit-mounted-path');
  expect(edge.persistence_witness).toMatch(/^[0-9a-f-]{36}$/i);
});

test('home page loads through the Worker', async ({ page, request }, testInfo) => {
  const direct = await request.get(`${productionOrigin}/`, { maxRedirects: 0 });
  expect(direct.status()).toBe(200);
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe(await direct.text());
  await expect(page.locator('body')).toBeVisible();
  await testInfo.attach('home.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('unauthenticated API passes the actual rate limiter and preserves auth denial', async ({ request }) => {
  const direct = await request.get(`${productionOrigin}/api/auth/me`, { maxRedirects: 0 });
  const edge = await request.get('/api/auth/me', { maxRedirects: 0 });
  expect([401, 403]).toContain(direct.status());
  expect(edge.status()).toBe(direct.status());
  expect(edge.headers()['x-storyengine-edge']).toBeUndefined();
  const { request_id: directId, ...directPayload } = await direct.json();
  const { request_id: edgeId, ...edgePayload } = await edge.json();
  // Separate requests receive separate trace IDs; compare the auth contract
  // while requiring a real runtime-generated ID on each response.
  expect(directId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(edgeId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(edgeId).not.toBe(directId);
  expect(edgePayload).toEqual(directPayload);
  expect(edgePayload.error).toBe('unauthorized');
});
