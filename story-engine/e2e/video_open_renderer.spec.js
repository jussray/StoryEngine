import { test, expect } from '@playwright/test';
import { establishBrowserSession, ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

test('Story Video Studio separates plan proof, render infrastructure, continuity cookies, and actual footage', async ({ page, request }) => {
  await establishBrowserSession(page, ADMIN_BOOTSTRAP_KEY);

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
  expect(Array.isArray(runtimeStatus.blockers)).toBe(true);

  await page.goto(`/video_studio.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await expect(page.getByTestId('renderer-infrastructure')).toBeVisible();
  await expect(page.getByTestId('renderer-infrastructure')).toContainText('zero-credit vendor account never blocks');
  await expect(page.locator('#vendorCreditTruth')).toHaveText('Not required');

  await page.locator('#mode').selectOption('live_action');
  await page.locator('#visualStyle').selectOption('cinematic_realism');
  await page.locator('#primarySubject').fill('creator');
  await page.locator('#productOrWorld').fill('garden path');
  await page.locator('#viewerTakeaway').fill('The shot plan must become verified playable footage before delivery.');
  await page.locator('#actionBeats').fill('Creator steps from the porch.\nCreator walks toward the garden gate.');
  await page.locator('#generate').click();

  await expect(page.getByTestId('video-job-result')).toBeVisible();
  await expect(page.getByTestId('final-delivery-note')).toContainText('Plan ≠ finished movie');
  await expect(page.getByTestId('real-footage-production')).toBeVisible();
  await expect(page.getByTestId('actual-render-truth')).toContainText('Actual footage: 0/2 technically verified');
  await expect(page.getByTestId('continuity-marker')).toContainText('never authority');

  await page.locator('#refreshEvidence').click();
  await expect(page.getByTestId('continuity-cookie')).toContainText('lvz_cc_');
  const initialCookie = await page.getByTestId('continuity-cookie').textContent();
  expect(initialCookie).toBeTruthy();

  const renderButtons = page.locator('[data-render-shot]');
  await expect(renderButtons).toHaveCount(2);
  await expect(renderButtons.first()).toBeDisabled();
  await expect(page.getByTestId('canon-reference-image')).toBeVisible();

  await page.locator('#validateJob').click();
  await expect(page.getByTestId('video-job-status')).toHaveText('preview_validated');
  // No fake green: a verified plan plus zero vendor credits is still not actual footage.
  await expect(page.getByTestId('actual-render-truth')).toContainText('0/2 technically verified');
  await expect(renderButtons.first()).toBeDisabled();

  // Editing the canonical shot plan changes the continuity cookie and invalidates old proof.
  await page.getByTestId('shot-command-input').first().fill('/reaction creator');
  await page.getByTestId('save-shot-plan').click();
  await expect(page.getByTestId('video-job-status')).not.toHaveText('preview_validated');
  await page.locator('#refreshEvidence').click();
  await expect(page.getByTestId('continuity-cookie')).toContainText('lvz_cc_');
  const changedCookie = await page.getByTestId('continuity-cookie').textContent();
  expect(changedCookie).toBeTruthy();
  expect(changedCookie).not.toBe(initialCookie);

  if (runtimeStatus.ready !== true) {
    await expect(page.locator('[data-render-shot]').first()).toBeDisabled();
    await expect(page.locator('#rendererState')).not.toHaveText('Ready');
  }
});
