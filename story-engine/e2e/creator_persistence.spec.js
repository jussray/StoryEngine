import { test, expect } from '@playwright/test';
import { CREATOR_BOOTSTRAP_KEY, establishBrowserSession } from './session.js';

test('creator can create a real workspace, save a chapter, reload, and reopen persisted content', async ({ page }) => {
  await establishBrowserSession(page, CREATOR_BOOTSTRAP_KEY);

  const stamp = Date.now();
  const vision = `Persistence proof ${stamp}: a cartographer discovers a city that moves every midnight.`;
  const chapterTitle = `Proof Chapter ${stamp}`;
  const chapterBody = `At midnight the street signs turned toward the river. Persistence marker ${stamp}.`;

  await page.goto('/front_door.html');
  await page.locator('#vision').fill(vision);
  await page.getByRole('button', { name: 'Begin creating' }).click();

  await expect(page).toHaveURL(/\/story_engine\.html\?run_id=[^&]+&workspace_id=[^&]+$/);
  const createdUrl = new URL(page.url());
  const workspaceId = createdUrl.searchParams.get('workspace_id');
  expect(workspaceId).toBeTruthy();

  await page.goto(`/chapters.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await page.locator('#newTitle').fill(chapterTitle);
  await page.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('#editor')).not.toHaveClass(/hidden/);
  await page.locator('#chapterContent').fill(chapterBody);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Saved');

  await page.reload();
  await expect(page.locator('#chapterList')).toContainText(chapterTitle);
  await page.getByRole('button', { name: new RegExp(chapterTitle) }).click();
  await expect(page.locator('#editorTitleInput')).toHaveValue(chapterTitle);
  await expect(page.locator('#chapterContent')).toHaveValue(chapterBody);

  const persisted = await page.context().request.get(`/api/chapters/${encodeURIComponent(workspaceId)}`);
  expect(persisted.status()).toBe(200);
  const chapters = await persisted.json();
  expect(chapters.some(chapter => chapter.title === chapterTitle && chapter.content === chapterBody)).toBe(true);
});
