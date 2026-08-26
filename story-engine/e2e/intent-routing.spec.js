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
