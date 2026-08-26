import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

test('front door hands the exact run identity to the Story Engine', async ({ page }) => {
  const run = {
    run_id: 'run-proof-123',
    workspace_id: 'workspace-proof-456',
    status: 'writer_active',
    current_stage: 'story_engine',
    active_agent: 'Human',
    intent: { title: 'Moon Under Maple Street' },
    assist_profile: { assist_mode: 'writer' },
    stages: [{
      stage: 'story_engine',
      agent: 'Human',
      status: 'writer_active',
      summary: 'Writer workspace started.'
    }]
  };
  const requestedRunIds = [];

  await establishBrowserSession(page);

  await page.route('**/api/control-room/operator/assist-default', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ default_assist_mode: 'writer' })
    });
  });

  await page.route('**/api/story-engine/runs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(run)
    });
  });

  await page.route('**/api/story-engine/runs/*', async route => {
    const url = new URL(route.request().url());
    const runId = decodeURIComponent(url.pathname.split('/').at(-1));
    requestedRunIds.push(runId);
    await route.fulfill({
      status: runId === run.run_id ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(runId === run.run_id ? run : { error: 'Story Engine run not found.' })
    });
  });

  await page.goto('/front_door.html');
  await page.locator('#vision').fill('A child discovers a sleeping moon beneath her neighborhood.');
  await page.getByRole('button', { name: 'Begin' }).click();

  await expect(page).toHaveURL(new RegExp(`/story_engine\\.html\\?run_id=${run.run_id}&workspace_id=${run.workspace_id}$`));
  await expect(page.locator('#runTitle')).toHaveText(run.intent.title);
  await expect(page.locator('#runStatus')).toHaveText('writer_active');
  await expect(page.getByTestId('story-universe-link')).toHaveAttribute(
    'href',
    `/story_universe.html?workspace_id=${run.workspace_id}`
  );

  expect(requestedRunIds).toEqual([run.run_id]);
  expect(requestedRunIds).not.toContain(run.workspace_id);
});
