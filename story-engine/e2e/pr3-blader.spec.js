/**
 * PR #3 AFTER — Blader + Detector Ensemble
 * Run this spec against the goal/blader-detector-ensemble branch.
 * ALL tests must pass before PR #3 merges to main.
 *
 * Redteam: blader_score absence on main is documented in redteam-before-baseline.spec.js.
 * These tests are the adversarial "after" witness.
 */
import { test, expect } from '@playwright/test';

const ADMIN_KEY = 'playwright-test-key';
const WORKSPACE = 'pw-workspace-001';

const KNOWN_AI_TEXT =
  'The utilization of advanced methodologies facilitates the optimization of creative output ' +
  'through leveraging synergistic frameworks that enable stakeholders to maximize value delivery ' +
  'in a scalable and sustainable manner going forward.';

const KNOWN_HUMAN_TEXT =
  'She stopped at the door. Not because she was scared — she just wanted to remember it ' +
  'this way. The paint was peeling near the knob. Somebody should fix that.';

test.describe('PR #3 — Blader + Detector', () => {
  test('story run response includes blader_score as a number', async ({ request }) => {
    const r = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'Blader test run', format: 'short_story', audience: 'teen' }
    });
    // 200 or 202 accepted (async run); either way the schema must include blader_score
    expect([200, 202]).toContain(r.status());
    const body = await r.json();
    expect(typeof body.blader_score).toBe('number');
    expect(body.blader_score).toBeGreaterThanOrEqual(0);
    expect(body.blader_score).toBeLessThanOrEqual(100);
  });

  test('control-room overview includes blader_health panel', async ({ request }) => {
    const r = await request.get('/api/control-room/overview', {
      headers: { 'x-api-key': ADMIN_KEY }
    });
    expect(r.ok()).toBe(true);
    const body = await r.json();
    expect(body.blader_health).toBeDefined();
    expect(typeof body.blader_health.avg_score).toBe('number');
    expect(body.blader_health.threshold).toBeDefined();
  });

  test('known AI text produces lower blader score than known human text', async ({ request }) => {
    const [aiRes, humanRes] = await Promise.all([
      request.post('/api/blader/score', {
        headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
        data: { text: KNOWN_AI_TEXT }
      }),
      request.post('/api/blader/score', {
        headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
        data: { text: KNOWN_HUMAN_TEXT }
      })
    ]);
    expect(aiRes.ok()).toBe(true);
    expect(humanRes.ok()).toBe(true);
    const aiScore = (await aiRes.json()).blader_score;
    const humanScore = (await humanRes.json()).blader_score;
    expect(humanScore).toBeGreaterThan(aiScore);
  });

  test('redteam warns when blader score is below threshold', async ({ request }) => {
    const r = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: {
        workspace_id: WORKSPACE,
        title: 'Low score forced test',
        format: 'short_story',
        audience: 'teen',
        _test_force_draft: KNOWN_AI_TEXT
      }
    });
    expect([200, 202]).toContain(r.status());
    const body = await r.json();
    // Redteam warning must surface if score is below threshold
    if (body.blader_score < (body.blader_threshold ?? 60)) {
      expect(body.redteam_warnings).toContain('blader_score_below_threshold');
    }
  });

  test('detector report is included in story run result', async ({ request }) => {
    const r = await request.post('/api/story-engine/runs', {
      headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
      data: { workspace_id: WORKSPACE, title: 'Detector report test', format: 'short_story', audience: 'teen' }
    });
    expect([200, 202]).toContain(r.status());
    const body = await r.json();
    expect(body.detector_report).toBeDefined();
    expect(typeof body.detector_report.burstiness).toBe('number');
  });
});
