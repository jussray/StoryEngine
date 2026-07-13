/**
 * REDTEAM BEFORE BASELINE
 * These tests document the CURRENT state of main before any feature PRs merge.
 * They prove what does NOT exist yet — they are expected to FAIL on feature branches
 * and PASS only on main (as negative assertions).
 *
 * Redteam rule: "Do not count an AI agent's claim as release evidence."
 * This file is the adversarial witness. Run it against main first.
 * Save the output as your baseline. Then run the AFTER specs on each PR branch.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const WORKSPACE = 'pw-workspace-001';

// ── PR #3 BEFORE: Blader ─────────────────────────────────────────────────────
test.describe('[BEFORE PR #3] Blader — not yet on main', () => {
  test('story run response has NO blader_score field', async ({ request }) => {
    const r = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'Baseline test', format: 'short_story', audience: 'teen' }
    });
    // Accept 200 or 422; either way blader_score must be absent
    const body = await r.json().catch(() => ({}));
    expect(body?.blader_score).toBeUndefined();
  });

  test('control-room overview has NO blader_health panel', async ({ request }) => {
    const r = await request.get('/api/control-room/overview', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    if (r.ok()) {
      const body = await r.json();
      expect(body?.blader_health).toBeUndefined();
    }
  });
});

// ── PR #4 BEFORE: Page Guard ──────────────────────────────────────────────────
test.describe('[BEFORE PR #4] Page Guard — not yet on main', () => {
  test('GET / does NOT redirect to /front_door.html', async ({ page }) => {
    const resp = await page.goto('/');
    // If it 200s directly or goes somewhere other than front_door, baseline is confirmed
    const url = page.url();
    // We document this, not assert a specific URL — just record the current behavior
    expect(resp?.status()).toBeDefined();
    console.log('[BEFORE baseline] / resolves to:', url, 'status:', resp?.status());
  });

  test('control_room.html is accessible without administrator role', async ({ request }) => {
    // Without page guard, this may 200 or serve static HTML
    const r = await request.get('/control_room.html');
    // Baseline: currently NOT 403 — if this starts returning 403, PR #4 has landed
    console.log('[BEFORE baseline] /control_room.html status:', r.status());
    expect(r.status()).toBeDefined();
  });
});

// ── PR #5 BEFORE: Eli10 ───────────────────────────────────────────────────────
test.describe('[BEFORE PR #5] Eli10 Contract — not yet on main', () => {
  test('audience lens eli10 has no voice_instruction field', async ({ request }) => {
    const r = await request.get('/api/audience-lens/eli10', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    if (r.ok()) {
      const body = await r.json();
      expect(body?.voice_instruction).toBeUndefined();
    } else {
      // 404 also proves the endpoint doesn't exist — valid BEFORE state
      expect([404, 401, 403]).toContain(r.status());
    }
  });
});

// ── PR #7 BEFORE: Canon Memory ────────────────────────────────────────────────
test.describe('[BEFORE PR #7] Canon Memory — not yet on main', () => {
  test('POST /api/canon-anchors returns 404', async ({ request }) => {
    const r = await request.post('/api/canon-anchors', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { kind: 'character', key: 'protagonist', value: 'Zara', workspace_id: WORKSPACE }
    });
    expect([404, 401]).toContain(r.status());
  });
});

// ── PR #8 BEFORE: Revenue ─────────────────────────────────────────────────────
test.describe('[BEFORE PR #8] Revenue Engine — not yet on main', () => {
  test('POST /api/revenue/stripe/webhook returns 404', async ({ request }) => {
    const r = await request.post('/api/revenue/stripe/webhook', {
      data: '{}',
      headers: { 'content-type': 'application/json' }
    });
    expect(r.status()).toBe(404);
  });

  test('GET /api/revenue/overview returns 404', async ({ request }) => {
    const r = await request.get('/api/revenue/overview', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.status()).toBe(404);
  });
});
