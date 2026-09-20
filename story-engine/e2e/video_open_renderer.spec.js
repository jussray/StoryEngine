import { test, expect } from '@playwright/test';
import { establishBrowserSession, ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

test('Story Video Studio exposes self-hosted render truth and non-authorizing continuity markers', async ({ page, request }) => {
  await establishBrowserSession(page, { apiKey: ADMIN_BOOTSTRAP_KEY });

  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Open Render Truth ${Date.now()}`,
      genre: 'family',
      pitch: 'A creator turns a quiet sunrise scene into a finished cinematic short.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  const chapterResponse = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: {
      title: 'Sunrise',
      content: 'Morning light reaches the window. The creator walks from the porch toward a garden gate.',
      position: 0,
      memory_patches: []
    }
  });
  expect(chapterResponse.status()).toBe(201);

  const statusResponse = await request.get('/api/video-engine/open-renderer/status', { headers });
  expect(statusResponse.ok()).toBe(true);
  const runtimeStatus = await statusResponse.json();
  expect(runtimeStatus.primary_lane).toBe('self_hosted_open_weight');
  expect(runtimeStatus.vendor_credit_required).toBe(false);
  expect(runtimeStatus.authority).toBe('none');

  await page.goto(`/video_studio.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await expect(page.getByTestId('open-renderer-status-card')).toBeVisible();
  await expect(page.getByTestId('open-renderer-status-card')).toContainText('Vendor credits are not required');

  await page.locator('#mode').selectOption('live_action');
  await page.locator('#visualStyle').selectOption('cinematic_realism');
  await page.locator('#primarySubject').fill('creator');
  await page.locator('#productOrWorld').fill('garden path');
  await page.locator('#viewerTakeaway').fill('The shot plan must become verified playable footage before delivery.');
  await page.locator('#actionBeats').fill('Creator steps from the porch.\nCreator walks toward the garden gate.');
  await page.locator('#generate').click();

  await expect(page.getByTestId('video-job-result')).toBeVisible();
  await expect(page.getByTestId('final-delivery-note')).toContainText('self-hosted/open-weight GPU');
  await expect(page.getByTestId('continuity-cookie')).toContainText('lvz_cc_');
  await expect(page.getByTestId('actual-render-truth')).toContainText('Actual footage: 0/2');
  await expect(page.getByTestId('continuity-marker')).toContainText('never authority');

  const actualRender = page.getByTestId('open-render-actual');
  await expect(actualRender).toBeDisabled();
  await expect(page.getByTestId('actual-render-blocker')).toContainText('Playwright plan gate');

  await page.locator('#validateJob').click();
  await expect(page.getByTestId('video-job-status')).toHaveText('preview_validated');

  if (runtimeStatus.ready !== true) {
    await expect(actualRender).toBeDisabled();
    await expect(page.getByTestId('actual-render-blocker')).toContainText('GPU lane blocked');
  }
});
