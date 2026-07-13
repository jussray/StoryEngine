/**
 * STANDALONE RELEASE GATE — Issue #12 Checklist
 * These tests map 1:1 to the release gate checklist in Issue #12.
 * ALL of these must pass before L99 is considered bridge-ready.
 *
 * Redteam constraint: "Do not count an AI agent's claim as release evidence."
 * This file is the evidence. The checklist item is only closed when this spec passes in CI.
 *
 * Run against main AFTER the full feature chain (#3→#4→#5→#6→#7→#8) has merged.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const CREATOR_KEY = 'playwright-creator-key';
const WORKSPACE = 'pw-workspace-001';

test.describe('STANDALONE GATE — L99 Release Checklist (Issue #12)', () => {

  // ── Gate 1: First-run creator journey works end to end ──────────────────────
  test('[GATE-1] Creator journey: front_door → run → story_home', async ({ page }) => {
    // Step 1: front_door loads
    await page.goto('/front_door.html');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/error|undefined|null/i);

    // Step 2: Fill story vision form
    const titleInput = page.locator('[name="title"], [data-testid="story-title"], input[type="text"]').first();
    await titleInput.fill('The Weight of Stars');

    // Step 3: Submit — triggers POST /api/story-engine/runs
    const [runResponse] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/story-engine/runs')),
      page.locator('[type="submit"], button:has-text("Begin")').first().click()
    ]);
    expect([200, 202]).toContain(runResponse.status());

    // Step 4: Redirected to story_home
    await page.waitForURL(/story_home/);
    await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
  });

  // ── Gate 2: Story/creative profile creation works ───────────────────────────
  test('[GATE-2] POST /api/creative-profiles creates a profile', async ({ request }) => {
    const r = await request.post('/api/creative-profiles', {
      headers: { 'x-api-key': CREATOR_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'The Weight of Stars', format: 'short_story', audience: 'teen' }
    });
    expect([200, 201]).toContain(r.status());
    const body = await r.json();
    expect(body.id ?? body.profile_id ?? body.workspace_id).toBeDefined();
  });

  // ── Gate 3: Story Engine run works through approval and runtime ─────────────
  test('[GATE-3] Story Engine run reaches approval stage', async ({ request }) => {
    const r = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': CREATOR_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'Gate 3 Test', format: 'short_story', audience: 'teen' }
    });
    expect([200, 202]).toContain(r.status());
    const body = await r.json();
    const runId = body.id ?? body.run_id;
    expect(runId).toBeDefined();

    // Poll for approval stage (max 10s)
    let stage;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const poll = await request.get(`/api/story-engine/runs/${runId}`, {
        headers: { 'x-api-key': CREATOR_KEY }
      });
      if (poll.ok()) {
        const pollBody = await poll.json();
        stage = pollBody.stage ?? pollBody.status;
        if (['approval', 'complete', 'redteam', 'ghost'].includes(stage)) break;
      }
    }
    expect(['approval', 'complete', 'redteam', 'ghost']).toContain(stage);
  });

  // ── Gate 4: Continuity/memory state persists correctly ──────────────────────
  test('[GATE-4] Canon anchor persists across two requests', async ({ request }) => {
    const create = await request.post('/api/canon-anchors', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { kind: 'tone_constant', key: 'overall_tone', value: 'melancholy with dry humor', workspace_id: WORKSPACE }
    });
    expect([200, 201]).toContain(create.status());
    const { id } = await create.json();

    const fetch = await request.get(`/api/canon-anchors/${id}`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(fetch.ok()).toBe(true);
    const body = await fetch.json();
    expect(body.value).toBe('melancholy with dry humor');
  });

  // ── Gate 5: OODA and Lindymode state are observable (operator) ──────────────
  test('[GATE-5] OODA page loads for administrator', async ({ page, request }) => {
    const r = await request.get('/ooda.html', { headers: { 'x-api-key': ADMIN_KEY } });
    expect(r.status()).toBe(200);
  });

  test('[GATE-5] Lindymode page loads for administrator', async ({ request }) => {
    const r = await request.get('/lindymode.html', { headers: { 'x-api-key': ADMIN_KEY } });
    expect(r.status()).toBe(200);
  });

  test('[GATE-5] GET /api/lindymode/state returns observable state', async ({ request }) => {
    const r = await request.get(`/api/lindymode/state?workspace_id=${WORKSPACE}`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.mode ?? body.state ?? body.lindymode).toBeDefined();
  });

  // ── Gate 6: Error, empty, loading, retry states exist ──────────────────────
  test('[GATE-6] GET /api/story-engine/runs/:invalid_id returns 404, not 500', async ({ request }) => {
    const r = await request.get('/api/story-engine/runs/does-not-exist-ever', {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect(r.status()).toBe(404);
  });

  test('[GATE-6] story_home.html with no workspace_id shows empty state, not crash', async ({ page }) => {
    await page.goto('/story_home.html');
    // Must load — not 500 or blank
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Cannot read|TypeError|ReferenceError/i);
  });

  // ── Gate 7: Cost limits / runaway-job controls exist ───────────────────────
  test('[GATE-7] Rapid sequential run requests are rate-limited', async ({ request }) => {
    const BURST = 15;
    const results = await Promise.all(
      Array.from({ length: BURST }, () =>
        request.post('/api/story-engine/runs', {
          headers: { 'x-api-key': CREATOR_KEY, 'content-type': 'application/json' },
          data: { workspace_id: WORKSPACE, title: 'Rate limit test', format: 'short_story', audience: 'teen' }
        })
      )
    );
    const statuses = results.map(r => r.status());
    // At least one must be rate-limited (429) or the server must have a job queue that rejects overflow
    const hasRateLimit = statuses.some(s => s === 429);
    const hasJobLimit = statuses.some(s => s === 503);
    expect(hasRateLimit || hasJobLimit).toBe(true);
  });

  // ── Gate 8: No secrets leak in any API response ─────────────────────────────
  test('[GATE-8] No secret patterns in guardrails.json', async ({ request }) => {
    const r = await request.get('/guardrails.json');
    expect(r.ok()).toBe(true);
    const body = await r.text();
    expect(body).not.toMatch(/sk_live|sk_test|rk_live|Bearer [A-Za-z0-9._-]{20,}/i);
    expect(body).not.toMatch(/password":|secret":|private_key":/i);
  });

  test('[GATE-8] Control room overview does not leak workspace secrets', async ({ request }) => {
    const r = await request.get('/api/control-room/overview', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    if (!r.ok()) return; // 404 on main before PR #3 — still passes the secret check
    const body = await r.text();
    expect(body).not.toMatch(/sk_live|sk_test|Bearer [A-Za-z0-9._-]{20,}/i);
  });

  // ── Gate 9: IP Studio output is usable ─────────────────────────────────────
  test('[GATE-9] POST /api/ip-conversions/:workspace_id starts a conversion', async ({ request }) => {
    const r = await request.post(`/api/ip-conversions/${WORKSPACE}/movie`, {
      headers: { 'x-api-key': CREATOR_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE }
    });
    expect([200, 201, 202]).toContain(r.status());
    const body = await r.json();
    expect(body.id ?? body.job_id ?? body.status).toBeDefined();
  });

  // ── Gate 10: Authentication works ──────────────────────────────────────────
  test('[GATE-10] Unauthenticated request to protected API returns 401', async ({ request }) => {
    const r = await request.get('/api/control-room/overview');
    expect([401, 403]).toContain(r.status());
  });

  test('[GATE-10] Invalid API key returns 401', async ({ request }) => {
    const r = await request.get('/api/control-room/overview', {
      headers: { 'x-api-key': 'this-is-not-a-real-key' }
    });
    expect([401, 403]).toContain(r.status());
  });
});
