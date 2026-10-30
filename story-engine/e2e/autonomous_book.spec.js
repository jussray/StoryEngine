import { test, expect } from '@playwright/test';
import { ADMIN_BOOTSTRAP_KEY, TENANT_CREATOR_BOOTSTRAP_KEY, establishBrowserSession } from './session.js';

test('creator can answer StoryEngine questions and receive a persisted six-chapter book artifact', async ({ page }) => {
  await establishBrowserSession(page, TENANT_CREATOR_BOOTSTRAP_KEY);
  await page.goto('/story_engine.html');

  await page.locator('.type[data-medium="book"]').click();
  await page.locator('.assist-option[data-assist="autonomous_studio"]').click();
  await page.locator('#vision').fill(
    'A girl moves into an old house where one room contains objects from events that have not happened yet, and she must solve which future belongs to her family.'
  );
  await page.locator('#audience').selectOption('middle_grade');
  await page.locator('#kind').selectOption('mystery');
  await page.locator('#emotion').selectOption('wonder');

  const createdPromise = page.waitForResponse(response =>
    response.url().endsWith('/api/story-engine/runs')
      && response.request().method() === 'POST'
  );
  await expect(page.locator('#start')).toHaveText('Build the first version');
  await page.locator('#start').click();
  const createdResponse = await createdPromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  expect(created.status).toBe('runtime_queued');
  expect(created.workspace_id).toBeTruthy();
  expect(created.dispatch_id).toBeTruthy();

  // Queue draining requires administrator authorization; preserve creator session scope.
  const drainResponse = await page.context().request.post('/api/runtime/drain', {
    headers: { 'x-api-key': ADMIN_BOOTSTRAP_KEY },
    data: { limit: 5 }
  });
  expect(drainResponse.status()).toBe(200);
  const drained = await drainResponse.json();
  const dispatch = drained.processed.find(item => item.dispatch_id === created.dispatch_id);
  expect(dispatch?.status).toBe('completed');
  expect(dispatch?.manuscript).toMatchObject({ status: 'persisted', chapter_count: 6 });
  expect(dispatch.manuscript.word_count).toBeGreaterThan(300);

  await expect(page.locator('#runStatus')).toHaveText('complete', { timeout: 30_000 });
  await expect(page.getByTestId('story-artifact-link')).toBeVisible();
  const artifactHref = await page.getByTestId('story-artifact-link').getAttribute('href');
  expect(artifactHref).toMatch(/^\/api\/artifacts\/artifact_[^/]+\/html$/);

  await page.goto(artifactHref);
  await expect(page.getByTestId('l99-artifact')).toBeVisible();
  await expect(page.getByTestId('story-unit')).toHaveCount(6);
  const unitText = await page.getByTestId('story-unit-content').allTextContents();
  expect(unitText).toHaveLength(6);
  expect(unitText.every(text => text.trim().length >= 240)).toBe(true);
  expect(unitText.join(' ')).toContain('Mara');

  const artifactId = artifactHref.split('/').at(-2);
  const artifactResponse = await page.context().request.get(`/api/artifacts/${artifactId}`);
  expect(artifactResponse.status()).toBe(200);
  const artifact = await artifactResponse.json();
  expect(artifact.metadata.chapter_count).toBe(6);
  expect(artifact.validation).toMatchObject({
    passed: true,
    real_route_proof: true,
    validator: 'playwright_real_route_artifact_gate'
  });
  expect(artifact.validation.playwright).toMatchObject({
    passed: true,
    real_route_proof: true,
    http_status: 200,
    unit_count: 6,
    non_empty_unit_count: 6,
    expected_unit_count: 6
  });

  // A successful creator run must be discoverable in the new story home.
  await page.goto(`/story_home.html?workspace_id=${encodeURIComponent(created.workspace_id)}`);
  await expect(page.getByTestId('story-home-run-id')).toContainText(created.run_id);
  await expect(page.getByTestId('story-home-status')).toHaveText('Complete');
  await expect(page.getByRole('button', { name: 'Open in Story Engine' })).toBeVisible();
  await page.getByRole('button', { name: 'Open in Story Engine' }).click();
  await expect(page).toHaveURL(new RegExp(`story_engine\\.html\\?.*run_id=${created.run_id}`));
  await expect(page.locator('#runStatus')).toHaveText('complete');
});
