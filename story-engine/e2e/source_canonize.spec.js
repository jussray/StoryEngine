import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

const apiKey = 'playwright-test-key';
const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

async function sourceState(request, workspaceId) {
  const response = await request.get(`/api/memory/${encodeURIComponent(workspaceId)}/sources`, { headers });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('source understanding stays outside canon until creator approval, then survives reload', async ({ page, request }) => {
  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Source Canon Proof ${Date.now()}`,
      genre: 'fantasy',
      pitch: 'A creator turns lived material into a governed story universe.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  await establishBrowserSession(page);
  await page.goto(`/story_universe.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await expect(page.getByTestId('story-universe')).toBeVisible();
  await expect(page.locator('#pageStatus')).toContainText('Runtime connected');
  await expect(page.locator('#anchorCount')).toHaveText('0');

  await page.locator('#sourceTitle').fill('The Moon Key memory');
  await page.locator('#sourceType').selectOption('memory');
  await page.locator('#sourceText').fill(
    'Nia Vale always carries the Moon Key. Nia Vale never leaves a friend behind. Later, Nia Vale enters Moon City.'
  );
  await page.locator('#analyzeSource').click();

  await expect(page.locator('#sourceStatus')).toContainText('ready for review');
  await expect(page.locator('#sourceStatus')).toContainText('Nothing became canon');
  await expect(page.locator('#anchorCount')).toHaveText('0');

  const pending = page.getByTestId('source-proposal').filter({ hasText: 'character' }).first();
  await expect(pending).toBeVisible();
  await expect(pending).toHaveAttribute('data-status', 'pending');
  await pending.getByLabel('Canon key').fill('protagonist.name');
  await pending.getByLabel('Canonical truth').fill('Nia Vale');
  await pending.getByTestId('approve-proposal').click();

  await expect(page.locator('#sourceStatus')).toContainText('Approved');
  const canonRow = page.getByTestId('canon-row').filter({ hasText: 'protagonist.name' });
  await expect(canonRow).toContainText('Nia Vale');
  await expect(canonRow).toContainText('Creator locked');
  await expect(page.locator('#anchorCount')).toHaveText('1');

  const anotherPending = page.getByTestId('source-proposal').filter({ has: page.getByTestId('reject-proposal') }).first();
  await expect(anotherPending).toBeVisible();
  await anotherPending.getByTestId('reject-proposal').click();
  await expect(page.locator('#sourceStatus')).toContainText('Rejected');
  await expect(page.locator('#anchorCount')).toHaveText('1');

  await page.reload();
  await expect(page.locator('#pageStatus')).toContainText('Runtime connected');
  await expect(page.getByTestId('canon-row').filter({ hasText: 'protagonist.name' })).toContainText('Nia Vale');
  await expect(page.getByTestId('source-proposal').filter({ hasText: 'protagonist.name' })).toHaveAttribute('data-status', 'approved');

  const state = await sourceState(request, workspaceId);
  expect(state.counts.sources).toBe(1);
  expect(state.counts.approved).toBe(1);
  expect(state.counts.rejected).toBeGreaterThanOrEqual(1);

  const canonResponse = await request.get(`/api/memory/${encodeURIComponent(workspaceId)}/canon`, { headers });
  expect(canonResponse.ok()).toBe(true);
  const canon = await canonResponse.json();
  expect(canon.anchor_count).toBe(1);
  expect(canon.anchors.character['protagonist.name']).toEqual({
    value: 'Nia Vale',
    locked: true,
    source: 'human'
  });
});
