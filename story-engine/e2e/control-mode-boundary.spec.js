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

test('browser clients request continuity outcomes rather than Lindymode execution', async ({ page }) => {
  await establishBrowserSession(page);
  await page.goto('/front_door.html?workspace_id=proof-workspace');

  const sources = await page.evaluate(async () => {
    const readProtectedAsset = async (path) => {
      const response = await fetch(path);
      return { status: response.status, source: await response.text() };
    };

    return {
      chapters: await readProtectedAsset('/chapters.js'),
      dashboard: await readProtectedAsset('/lindymode_dashboard.js'),
    };
  });

  expect(sources.chapters.status).toBe(200);
  expect(sources.chapters.source).toContain('/api/intents/check-continuity/');
  expect(sources.chapters.source).toContain('/api/intents/resolve-continuity-incident/');
  expect(sources.chapters.source).not.toContain('/api/lindymode/analyze/');
  expect(sources.chapters.source).not.toContain('/api/lindymode/recover/');

  expect(sources.dashboard.status).toBe(200);
  expect(sources.dashboard.source).toContain('/api/intents/check-continuity/');
  expect(sources.dashboard.source).toContain('/api/intents/update-continuity-state/');
  expect(sources.dashboard.source).toContain('/api/intents/resolve-continuity-incident/');
  expect(sources.dashboard.source).not.toContain('/api/lindymode/analyze/');
  expect(sources.dashboard.source).not.toContain('/api/lindymode/recover/');
  expect(sources.dashboard.source).not.toContain("method: 'PUT'");
});
