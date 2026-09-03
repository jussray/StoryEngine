import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

test('browser sessions cannot invoke mode-named Lindymode workflow endpoints directly', async ({ page }) => {
  await establishBrowserSession(page);
  await page.goto('/front_door.html?workspace_id=proof-workspace');

  const result = await page.evaluate(async () => {
    const response = await fetch('/api/lindymode/analyze/999999', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  });

  expect(result.status).toBe(403);
  expect(result.body.error).toBe('internal_controller_required');
});

test('neutral intent boundary rejects caller-selected mode and workflow fields', async ({ page }) => {
  await establishBrowserSession(page);
  await page.goto('/front_door.html?workspace_id=proof-workspace');

  for (const payload of [
    { mode: 'lindymode' },
    { workflow: 'redteam' },
    { command: '/ooda' },
    { lens: 'l99' },
  ]) {
    const result = await page.evaluate(async (body) => {
      const response = await fetch('/api/intents/check-continuity/999999', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }, payload);

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('control_mode_not_user_selectable');
  }
});

test('browser clients request continuity outcomes rather than Lindymode execution', async ({ request }) => {
  const chapters = await request.get('/chapters.js');
  expect(chapters.status()).toBe(200);
  const chaptersSource = await chapters.text();
  expect(chaptersSource).toContain('/api/intents/check-continuity/');
  expect(chaptersSource).toContain('/api/intents/resolve-continuity-incident/');
  expect(chaptersSource).not.toContain('/api/lindymode/analyze/');
  expect(chaptersSource).not.toContain('/api/lindymode/recover/');

  const dashboard = await request.get('/lindymode_dashboard.js');
  expect(dashboard.status()).toBe(200);
  const dashboardSource = await dashboard.text();
  expect(dashboardSource).toContain('/api/intents/check-continuity/');
  expect(dashboardSource).toContain('/api/intents/update-continuity-state/');
  expect(dashboardSource).toContain('/api/intents/resolve-continuity-incident/');
  expect(dashboardSource).not.toContain('/api/lindymode/analyze/');
  expect(dashboardSource).not.toContain('/api/lindymode/recover/');
  expect(dashboardSource).not.toContain("method: 'PUT'");
});
