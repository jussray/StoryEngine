import { test, expect } from '@playwright/test';

const apiKey = 'playwright-test-key';
const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

test('free Story Video Engine creates, validates, and reports an artifact in Control Room', async ({ page, request, context }) => {
  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Playwright Lantern ${Date.now()}`,
      genre: 'fantasy',
      pitch: 'A girl follows a glowing paper bird through a storm.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  const chapterResponse = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: {
      title: 'The Paper Bird',
      content: 'Rain covered the street. A violet paper bird opened its wings and waited for Nia to follow.',
      position: 0,
      memory_patches: [{ entity_type: 'character', entity_id: 'nia', field: 'name', new_value: 'Nia' }]
    }
  });
  expect(chapterResponse.status()).toBe(202);

  const jobResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'anime_2d',
      quality: 'draft',
      aspect_ratio: '9:16'
    }
  });
  expect(jobResponse.status()).toBe(201);
  const job = await jobResponse.json();
  expect(job.status).toBe('ready_for_validation');
  expect(job.blueprint.target_mode).toBe('anime_2d');
  expect(job.blueprint.preview_renderer).toBe('motion_book_html');
  expect(job.blueprint.cost_plan.estimated_cost_usd).toBe(0);
  expect(job.blueprint.shot_count).toBeGreaterThan(0);

  const artifactResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html`, { headers });
  expect(artifactResponse.ok()).toBe(true);
  const artifactHtml = await artifactResponse.text();
  expect(artifactHtml).toContain('data-testid="l99-video-artifact"');
  expect(artifactHtml).toContain('data-target-mode="anime_2d"');
  expect(artifactHtml).toContain('Provider cost: $0.00');

  const validationResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/validate`, {
    headers,
    data: {}
  });
  expect(validationResponse.status()).toBe(200);
  const validated = await validationResponse.json();
  expect(validated.status).toBe('validated');
  expect(validated.validation.validator).toBe('playwright_story_video_gate');
  expect(validated.validation.playwright.passed).toBe(true);
  expect(validated.validation.structural.zero_provider_cost).toBe(true);

  await context.addCookies([{ name: 'l99_api_key', value: apiKey, domain: '127.0.0.1', path: '/', sameSite: 'Strict' }]);
  await page.addInitScript(key => window.sessionStorage.setItem('l99_api_key', key), apiKey);
  await page.goto('/control_room.html');
  await expect(page.getByTestId('video-engine-section')).toBeVisible();
  await expect(page.getByTestId('video-engine-machine-status')).toContainText(/verified|awaiting_validation/);
  await expect(page.getByTestId('video-engine-validated')).not.toHaveText('0');
  await expect(page.getByTestId('video-engine-job').first()).toContainText(workspaceId);

  await page.goto(`/video_studio.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await expect(page).toHaveTitle('L99 Story Video Studio');
  await expect(page.getByTestId('video-studio')).toBeVisible();
  await expect(page.locator('#workspaceId')).toHaveValue(workspaceId);
});
