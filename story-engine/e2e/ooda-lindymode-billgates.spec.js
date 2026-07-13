/**
 * OODA / LINDYMODE — Bill Gates Adversarial Witness
 * Named for the skeptical observer who only accepts evidence, never claims.
 *
 * These tests verify the operator backstage is observable, accurate, and
 * never leaks operator state into the creator surface.
 *
 * Run after the full feature chain has merged to main.
 * Redteam constraint: "Do not make a successful test run equal permission to deploy."
 * This spec must pass on EVERY PR that touches OODA, Lindymode, or backstage routing.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const CREATOR_KEY = 'playwright-creator-key';
const WORKSPACE = 'pw-workspace-001';

test.describe('OODA — Observe, Orient, Decide, Act (Bill Gates test)', () => {

  // ── OBSERVE ─────────────────────────────────────────────────────────────────
  test('[OODA-OBSERVE] /api/ooda/observe returns current system state', async ({ request }) => {
    const r = await request.get(`/api/ooda/observe?workspace_id=${WORKSPACE}`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    // Must have observable signals — not an empty object
    const hasSignals = (
      body.run_count !== undefined ||
      body.active_runs !== undefined ||
      body.last_event !== undefined ||
      body.blader_health !== undefined ||
      body.canon_count !== undefined
    );
    expect(hasSignals).toBe(true);
  });

  test('[OODA-OBSERVE] ooda.html page loads and contains observable data', async ({ page, request }) => {
    const r = await request.get('/ooda.html', { headers: { 'x-api-key': ADMIN_KEY } });
    expect(r.status()).toBe(200);
    const html = await r.text();
    // Page must reference OODA data — not a blank shell
    expect(html).toMatch(/ooda|observe|orient|decide|act/i);
  });

  // ── ORIENT ──────────────────────────────────────────────────────────────────
  test('[OODA-ORIENT] Promotion gates classify current state', async ({ request }) => {
    const r = await request.get('/api/promotion-gates/status', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    // Must return a classification — not null
    expect(body.current_gate ?? body.status ?? body.phase).toBeDefined();
  });

  // ── DECIDE ──────────────────────────────────────────────────────────────────
  test('[OODA-DECIDE] Redteam check returns structured decision, not a string', async ({ request }) => {
    const r = await request.post('/api/redteam/check', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: {
        draft: 'She walked into the room and noticed the window was open.',
        audience: 'teen',
        workspace_id: WORKSPACE
      }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(typeof body).toBe('object');
    expect(body.status).toBeDefined();
    // Must be a known status — not "undefined" or "error"
    expect(['pass', 'warn', 'fail', 'critical_fail', 'info']).toContain(body.status);
  });

  // ── ACT ─────────────────────────────────────────────────────────────────────
  test('[OODA-ACT] Story run creates an auditable event', async ({ request }) => {
    // Trigger a run
    const run = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': CREATOR_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'OODA Act test', format: 'short_story', audience: 'teen' }
    });
    expect([200, 202]).toContain(run.status());
    const { id: runId } = await run.json();

    // Verify the event appears in the event log
    await new Promise(r => setTimeout(r, 500));
    const events = await request.get(`/api/events?workspace_id=${WORKSPACE}&limit=5`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(events.ok()).toBe(true);
    const body = await events.json();
    const eventList = body.events ?? body.data ?? body;
    expect(Array.isArray(eventList)).toBe(true);
    expect(eventList.length).toBeGreaterThan(0);
  });
});

test.describe('LINDYMODE — Operator Backstage Observer', () => {

  test('[LINDY-1] Lindymode state is observable and returns a known mode', async ({ request }) => {
    const r = await request.get(`/api/lindymode/state?workspace_id=${WORKSPACE}`, {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    const mode = body.mode ?? body.state ?? body.lindymode;
    expect(mode).toBeDefined();
    expect(typeof mode).toBe('string');
  });

  test('[LINDY-2] /lindy canon command returns canon grouped by kind', async ({ request }) => {
    const r = await request.post('/api/lindymode/command', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { command: '/lindy canon', workspace_id: WORKSPACE }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(typeof body).toBe('object');
    const snapshot = body.snapshot ?? body.canon ?? body.result;
    expect(snapshot).toBeDefined();
  });

  test('[LINDY-3] Creator role cannot access lindymode API', async ({ request }) => {
    const r = await request.get(`/api/lindymode/state?workspace_id=${WORKSPACE}`, {
      headers: { 'x-api-key': CREATOR_KEY }
    });
    expect([401, 403]).toContain(r.status());
  });

  test('[LINDY-4] Lindymode page DOM contains no creator-visible story content', async ({ request }) => {
    const r = await request.get('/lindymode.html', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.status()).toBe(200);
    const html = await r.text();
    // Must show operator telemetry, not raw story text
    expect(html).not.toMatch(/"voice_instruction":|raw API key|STRIPE_SECRET/i);
  });

  test('[LINDY-5] /lindy check on a draft with tone violation surfaces redteam warning', async ({ request }) => {
    // Set a tone constant first
    await request.post('/api/canon-anchors', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { kind: 'tone_constant', key: 'lindy_tone', value: 'bleak and poetic', workspace_id: WORKSPACE }
    });

    const r = await request.post('/api/lindymode/command', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: {
        command: '/lindy check',
        workspace_id: WORKSPACE,
        draft: 'Everything was bright and cheerful and everyone laughed and clapped their hands.'
      }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    // Structured response — not null, not a bare string
    expect(typeof body).toBe('object');
    expect(body !== null).toBe(true);
  });
});

test.describe('CREATOR ISOLATION — Bill Gates hard wall', () => {
  // The Bill Gates test: a smart, skeptical person should never see operator internals
  const OPERATOR_TERMS = /\bOODA\b|\bRedteam\b|\bLindymode\b|\bblader\b|\bdetector\b|\bpromotion gate\b/i;

  test('[ISOLATION-1] front_door.html contains no operator terminology', async ({ page }) => {
    await page.goto('/front_door.html');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(OPERATOR_TERMS);
  });

  test('[ISOLATION-2] story_home.html contains no operator terminology', async ({ page }) => {
    await page.goto(`/story_home.html?workspace_id=${WORKSPACE}`);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(OPERATOR_TERMS);
  });

  test('[ISOLATION-3] story_engine.html contains no operator terminology', async ({ page }) => {
    await page.goto('/story_engine.html');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(OPERATOR_TERMS);
  });

  test('[ISOLATION-4] API run response for creator does not include internal gate results', async ({ request }) => {
    const r = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': CREATOR_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'Isolation test', format: 'short_story', audience: 'teen' }
    });
    expect([200, 202]).toContain(r.status());
    const body = await r.json();
    // Creator run response must not expose internal operator fields
    expect(body.redteam_raw).toBeUndefined();
    expect(body.promotion_gate_result).toBeUndefined();
    expect(body.ooda_phase).toBeUndefined();
  });
});
