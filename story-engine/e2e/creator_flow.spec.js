import { test, expect } from '@playwright/test';
import { ADMIN_BOOTSTRAP_KEY, establishBrowserSession } from './session.js';

test('front door preserves base context through shape step and hands exact run identity to the StoryEngine studio', async ({ page }) => {
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
  let createPayload = null;

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
    createPayload = route.request().postDataJSON();
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

  // Prove an upgrade from an older browser state cannot leave the bootstrap key
  // behind. The current client must purge both browser storage mechanisms on load.
  await page.evaluate(() => {
    sessionStorage.setItem('l99_api_key', 'legacy-session-secret');
    localStorage.setItem('l99_api_key', 'legacy-local-secret');
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => ({
    session: sessionStorage.getItem('l99_api_key'),
    local: localStorage.getItem('l99_api_key')
  }))).toEqual({ session: null, local: null });

  await expect(page.getByRole('heading', { name: 'What do you want to create?' })).toBeVisible();
  await expect(page.getByText('Powered by L99')).toHaveCount(0);

  const baseContext = 'A child discovers a sleeping moon beneath her neighborhood.';
  await page.locator('#vision').fill(baseContext);
  await page.getByRole('button', { name: /Begin creating/ }).click();

  await expect(page.getByRole('heading', { name: 'Let’s shape your idea.' })).toBeVisible();
  await expect(page.locator('#ideaPreview')).toHaveText(baseContext);
  await expect(page.getByRole('button', { name: /Continue to studio/ })).toBeVisible();

  await page.getByRole('button', { name: /Continue to studio/ }).click();

  expect(createPayload).toMatchObject({
    story_vision: baseContext,
    medium: 'book',
    audience: 'young_adult',
    story_kind: 'other',
    emotional_effect: 'fear',
    assist_mode: 'writer',
    estimated_cost: 0
  });

  await expect(page).toHaveURL(new RegExp(`/story_engine\\.html\\?run_id=${run.run_id}&workspace_id=${run.workspace_id}$`));
  await expect(page.locator('#runTitle')).toHaveText(run.intent.title);
  await expect(page.locator('#runStatus')).toHaveText('writer_active');
  await expect(page.getByTestId('story-universe-link')).toHaveAttribute(
    'href',
    `/story_universe.html?workspace_id=${run.workspace_id}`
  );
  await expect(page.locator('#creationCard')).toHaveClass(/hidden/);
  await expect(page.getByText('L99 runtime', { exact: false })).toHaveCount(0);

  expect(requestedRunIds).toEqual([run.run_id]);
  expect(requestedRunIds).not.toContain(run.workspace_id);
});

test('anonymous front door is cinematic and never asks for a bootstrap credential', async ({ page, request }) => {
  const dialogs = [];
  let createRequests = 0;
  page.on('dialog', dialog => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  page.on('request', req => {
    if (new URL(req.url()).pathname === '/api/story-engine/runs' && req.method() === 'POST') {
      createRequests += 1;
    }
  });

  const unauthenticated = await request.get('/api/auth/me');
  expect(unauthenticated.status()).toBe(401);

  const landing = await page.goto('/');
  expect(landing?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'What do you want to create?' })).toBeVisible();
  await expect(page.locator('.hero-art')).toBeVisible();
  await expect(page.locator('#creatorAccess')).toBeHidden();

  await page.locator('#vision').fill('A lighthouse becomes a portal to a world of living books.');
  await page.getByRole('button', { name: /Begin creating/ }).click();
  await expect(page.getByRole('heading', { name: 'Let’s shape your idea.' })).toBeVisible();
  await page.getByRole('button', { name: /Continue to studio/ }).click();

  await expect(page.locator('#creatorAccess')).toBeVisible();
  await expect(page.locator('#creatorAccessKey')).toBeEmpty();
  expect(dialogs).toEqual([]);
  expect(createRequests).toBe(0);

  await page.locator('#creatorAccessKey').fill('invalid-invitation');
  await page.getByRole('button', { name: 'Enter studio' }).click();
  await expect(page.locator('#creatorAccessStatus')).toContainText('could not be verified');
  await expect(page.locator('#creatorAccessKey')).toBeEmpty();
  expect(createRequests).toBe(0);
});

test('explicit private beta sign-in creates a server session before the creator run', async ({ page }) => {
  let createRequests = 0;
  await page.route('**/api/story-engine/runs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    createRequests += 1;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ run_id: 'private-run', workspace_id: 'private-workspace' })
    });
  });

  await page.goto('/front_door.html');
  await page.locator('#vision').fill('A city of ink and paper opens its gates to creators.');
  await page.getByRole('button', { name: /Begin creating/ }).click();
  await page.getByRole('button', { name: /Continue to studio/ }).click();
  await expect(page.locator('#creatorAccess')).toBeVisible();

  await page.locator('#creatorAccessKey').fill(ADMIN_BOOTSTRAP_KEY);
  await page.getByRole('button', { name: 'Enter studio' }).click();

  await expect(page).toHaveURL(/\/story_engine\.html\?run_id=private-run&workspace_id=private-workspace$/);
  expect(createRequests).toBe(1);
  const me = await page.context().request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).authenticated).toBe(true);
});
