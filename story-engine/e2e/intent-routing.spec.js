import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

const routes = [
  ['Write manuscript', '/chapters.html'],
  ['Control current AI run', '/story_engine.html'],
  ['Manage characters, world, and canon', '/story_universe.html'],
  ['Adapt to video', '/video_studio.html'],
  ['Inspect releases', '/release_gate.html'],
  ['Operate system', '/control_room.html'],
];

const workspaceScopedLabels = [
  'Write manuscript',
  'Manage characters, world, and canon',
  'Adapt to video',
  'Inspect releases'
];

test('intent router is a public bootstrap asset and scoped intents fail closed without context', async ({ page, request }) => {
  const asset = await request.get('/intent_router.js');
  expect(asset.status()).toBe(200);
  expect(await asset.text()).toContain('L99IntentRouter');

  await establishBrowserSession(page);
  await page.goto('/front_door.html');

  expect(await page.evaluate(() => Boolean(window.L99IntentRouter))).toBe(true);

  for (const label of workspaceScopedLabels) {
    await expect(page.getByRole('button', { name: label, exact: false })).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'Control current AI run', exact: false })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Operate system', exact: false })).toBeEnabled();
  await expect(page.locator('#contextNote')).toContainText('Open or create a story');

  const routedWithoutContext = await page.evaluate(() => window.L99IntentRouter.route('WRITE'));
  expect(routedWithoutContext).toBe(false);
  await expect(page).toHaveURL(/\/front_door\.html$/);
});

test('workspace context unlocks workspace rooms without fabricating active-run authority', async ({ page }) => {
  await establishBrowserSession(page);
  await page.goto('/front_door.html?workspace_id=proof-workspace');

  for (const label of workspaceScopedLabels) {
    await expect(page.getByRole('button', { name: label, exact: false })).toBeEnabled();
  }
  await expect(page.getByRole('button', { name: 'Control current AI run', exact: false })).toBeDisabled();
});

for (const [label, destination] of routes) {
  test(`${label} routes to the owning L99 room`, async ({ page }) => {
    await establishBrowserSession(page);
    await page.goto('/front_door.html?workspace_id=proof-workspace&run_id=proof-run&story_id=proof-story');

    await page.getByRole('button', { name: label, exact: false }).click();

    await expect(page).toHaveURL(new RegExp(
      destination.replace('.', '\\.') + '(?:\\?|$)'
    ));

    const url = new URL(page.url());
    expect(url.searchParams.get('workspace_id')).toBe('proof-workspace');
    expect(url.searchParams.get('run_id')).toBe('proof-run');
    expect(url.searchParams.get('story_id')).toBe('proof-story');
  });
}
