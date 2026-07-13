/**
 * PR #5 AFTER — Eli10 Audience Engine
 * Run this spec against the goal/eli10-audience-engine branch.
 * ALL tests must pass before PR #5 merges to main.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const WORKSPACE = 'pw-workspace-001';

const CONDESCENDING_DRAFT =
  'The little ones need to understand, in simple terms that even a young child can grasp, ' +
  'that sharing is caring. Can you say that? Sharing is caring! Good job, sweetie.';

const BABY_TALK_DRAFT =
  'Dey went to da big scawy fowest. It was weally weally dark in dere. ' +
  'Da wittle bunny was fwightened and cried a wittle bit. Aww!';

const CLEAN_DRAFT =
  'She looked at the map again. The trail split three ways and none of them had signs. ' +
  'Marcus said to pick the one that looked most used. She picked the one that looked least.';

test.describe('PR #5 — Eli10 Audience Engine', () => {
  test('GET /api/audience-lens/eli10 returns full contract shape', async ({ request }) => {
    const r = await request.get('/api/audience-lens/eli10', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.voice_instruction).toBeDefined();
    expect(body.stakes_model).toBeDefined();
    expect(body.darkness_policy).toBeDefined();
    expect(typeof body.voice_instruction).toBe('string');
    expect(body.voice_instruction.length).toBeGreaterThan(10);
  });

  test('Eli10 lens includes condescension gate definition', async ({ request }) => {
    const r = await request.get('/api/audience-lens/eli10', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    const body = await r.json();
    expect(body.redteam_gates).toBeDefined();
    const hasCondescensionGate = body.redteam_gates.some(
      (g) => g.id === 'condescension' || g.type === 'condescension'
    );
    expect(hasCondescensionGate).toBe(true);
  });

  test('condescending draft triggers redteam warning', async ({ request }) => {
    const r = await request.post('/api/redteam/check', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { draft: CONDESCENDING_DRAFT, audience: 'eli10', workspace_id: WORKSPACE }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    const flags = body.flags ?? body.warnings ?? [];
    expect(flags).toContain('condescension');
  });

  test('baby-talk draft triggers critical_fail', async ({ request }) => {
    const r = await request.post('/api/redteam/check', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { draft: BABY_TALK_DRAFT, audience: 'eli10', workspace_id: WORKSPACE }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.status).toBe('critical_fail');
  });

  test('clean prose passes eli10 redteam gate', async ({ request }) => {
    const r = await request.post('/api/redteam/check', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { draft: CLEAN_DRAFT, audience: 'eli10', workspace_id: WORKSPACE }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(['pass', 'info']).toContain(body.status);
  });

  test('no OODA/Lindymode/Redteam labels visible in creator story_home', async ({ page }) => {
    await page.goto(`/story_home.html?workspace_id=${WORKSPACE}`);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bOODA\b|\bRedteam\b|\bLindymode\b/i);
  });
});
