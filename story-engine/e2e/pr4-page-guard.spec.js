/**
 * PR #4 AFTER — Front / Back Stage Split
 * Run this spec against the goal/front-back-stage-split branch.
 * ALL tests must pass before PR #4 merges to main.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const CREATOR_KEY = 'playwright-creator-key';

test.describe('PR #4 — Page Guard: Front/Back Stage Split', () => {
  test('GET / redirects to /front_door.html', async ({ page }) => {
    await page.goto('/');
    expect(page.url()).toContain('front_door.html');
  });

  test('creator role: story_engine.html is accessible (200)', async ({ request }) => {
    const r = await request.get('/story_engine.html', {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect(r.status()).toBe(200);
  });

  test('creator role: front_door.html is accessible (200)', async ({ request }) => {
    const r = await request.get('/front_door.html', {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect(r.status()).toBe(200);
  });

  test('creator role: control_room.html returns 403', async ({ request }) => {
    const r = await request.get('/control_room.html', {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect(r.status()).toBe(403);
  });

  test('creator role: ooda.html returns 403', async ({ request }) => {
    const r = await request.get('/ooda.html', {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect(r.status()).toBe(403);
  });

  test('creator role: lindymode.html returns 403', async ({ request }) => {
    const r = await request.get('/lindymode.html', {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect(r.status()).toBe(403);
  });

  test('administrator role: control_room.html is accessible (200)', async ({ request }) => {
    const r = await request.get('/control_room.html', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.status()).toBe(200);
  });

  test('administrator role: ooda.html is accessible (200)', async ({ request }) => {
    const r = await request.get('/ooda.html', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.status()).toBe(200);
  });

  test('unauthenticated request to operator page returns 401', async ({ request }) => {
    const r = await request.get('/control_room.html');
    expect([401, 403]).toContain(r.status());
  });

  test('unknown page returns 404', async ({ request }) => {
    const r = await request.get('/this-page-does-not-exist-at-all.html', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.status()).toBe(404);
  });

  test('no operator text visible in creator DOM', async ({ page }) => {
    await page.goto('/front_door.html');
    const body = await page.locator('body').innerText();
    // OODA, Redteam, Lindymode, blader must never appear in creator-facing HTML
    expect(body).not.toMatch(/\bOODA\b|\bRedteam\b|\bLindymode\b|\bblader\b/i);
  });
});
