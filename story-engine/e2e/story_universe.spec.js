import { test, expect } from '@playwright/test';

const apiKey = 'playwright-test-key';
const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

test('Story Universe persists creator-locked canon through the real runtime', async ({ page, request }) => {
  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Universe Proof ${Date.now()}`,
      genre: 'fantasy',
      pitch: 'A creator-owned world whose facts survive every format.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const story = await storyResponse.json();
  const workspaceId = story.workspace_id;

  await page.addInitScript(key => window.sessionStorage.setItem('l99_api_key', key), apiKey);
  await page.goto(`/story_universe.html?workspace_id=${encodeURIComponent(workspaceId)}`);

  await expect(page.getByTestId('story-universe')).toBeVisible();
  await expect(page.locator('#pageStatus')).toContainText('Runtime connected');
  await expect(page.locator('#anchorCount')).toHaveText('0');

  await page.locator('#kind').selectOption('character');
  await page.locator('#key').fill('protagonist.name');
  await page.locator('#value').fill('Nia Vale is the protagonist.');
  await page.locator('#locked').check();
  await page.locator('#saveCanon').click();

  await expect(page.locator('#formStatus')).toContainText('Persisted');
  const canonRow = page.getByTestId('canon-row').filter({ hasText: 'protagonist.name' });
  await expect(canonRow).toContainText('Nia Vale is the protagonist.');
  await expect(canonRow).toContainText('Creator locked');
  await expect(page.locator('#anchorCount')).toHaveText('1');
  await expect(page.locator('#lockedCount')).toHaveText('1');

  // Browser reload is the boundary that catches presentation-only fake state.
  await page.reload();
  await expect(page.locator('#pageStatus')).toContainText('Runtime connected');
  await expect(page.getByTestId('canon-row').filter({ hasText: 'protagonist.name' }))
    .toContainText('Nia Vale is the protagonist.');

  const canonResponse = await request.get(`/api/memory/${encodeURIComponent(workspaceId)}/canon`, { headers });
  expect(canonResponse.ok()).toBe(true);
  const canon = await canonResponse.json();
  expect(canon.anchor_count).toBe(1);
  expect(canon.locked_count).toBe(1);
  expect(canon.anchors.character['protagonist.name']).toEqual({
    value: 'Nia Vale is the protagonist.',
    locked: true,
    source: 'human'
  });

  await page.goto(`/story_engine.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  const universeLink = page.getByTestId('story-universe-link');
  await expect(universeLink).toBeVisible();
  await expect(universeLink).toHaveAttribute(
    'href',
    `/story_universe.html?workspace_id=${encodeURIComponent(workspaceId)}`
  );
});
