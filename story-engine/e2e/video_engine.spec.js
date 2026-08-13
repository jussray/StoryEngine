import { test, expect } from '@playwright/test';

const apiKey = 'playwright-test-key';
const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
const scopedHeaders = { 'x-api-key': 'playwright-scoped-key', 'Content-Type': 'application/json' };

async function createAndValidateJob(request, workspaceId, look) {
  const jobResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: look.mode,
      visual_style: look.visual_style,
      quality: 'draft',
      aspect_ratio: look.aspect_ratio
    }
  });
  expect(jobResponse.status()).toBe(201);
  const job = await jobResponse.json();
  expect(job.status).toBe('ready_for_validation');
  expect(job.blueprint.target_mode).toBe(look.mode);
  expect(job.blueprint.visual_style).toBe(look.visual_style);
  expect(job.blueprint.preview_renderer).toBe('motion_book_html');
  expect(job.blueprint.cost_plan.estimated_cost_usd).toBe(0);
  expect(job.blueprint.shot_count).toBeGreaterThan(0);

  const artifactResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html`, { headers });
  expect(artifactResponse.ok()).toBe(true);
  const artifactHtml = await artifactResponse.text();
  expect(artifactHtml).toContain('data-testid="l99-video-artifact"');
  expect(artifactHtml).toContain(`data-target-mode="${look.mode}"`);
  expect(artifactHtml).toContain(`data-visual-style="${look.visual_style}"`);
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
  expect(validated.validation.structural.has_visual_style_marker).toBe(true);
  return validated;
}

test('free Story Video Engine validates multiple non-anime styles and reports them in Control Room', async ({ page, request, context }) => {
  const optionsResponse = await request.get('/api/video-engine/options', { headers });
  expect(optionsResponse.ok()).toBe(true);
  const options = await optionsResponse.json();
  expect(Object.keys(options.visual_styles).length).toBeGreaterThanOrEqual(10);
  expect(options.visual_styles.cinematic_realism.label).toBe('Cinematic Realism');
  expect(options.visual_styles.hand_drawn_cartoon.label).toBe('Hand-Drawn Cartoon');
  expect(options.visual_styles.watercolor_storybook.label).toBe('Watercolor Storybook');
  expect(options.visual_styles.anime.label).toBe('Anime');

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

  await createAndValidateJob(request, workspaceId, {
    mode: 'cinematic_3d',
    visual_style: 'cinematic_realism',
    aspect_ratio: '16:9'
  });
  await createAndValidateJob(request, workspaceId, {
    mode: 'animation_2d',
    visual_style: 'watercolor_storybook',
    aspect_ratio: '9:16'
  });

  const listResponse = await request.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/video-jobs`, { headers });
  expect(listResponse.status()).toBe(200);
  const listedJobs = await listResponse.json();
  expect(Array.isArray(listedJobs)).toBe(true);
  expect(listedJobs.length).toBeGreaterThanOrEqual(2);

  const forbiddenListResponse = await request.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/video-jobs`, {
    headers: scopedHeaders
  });
  expect(forbiddenListResponse.status()).toBe(403);
  await expect(forbiddenListResponse.json()).resolves.toMatchObject({
    error: 'workspace_forbidden',
    workspace_id: workspaceId
  });

  await context.addCookies([{ name: 'l99_api_key', value: apiKey, domain: '127.0.0.1', path: '/', sameSite: 'Strict' }]);
  await page.addInitScript(key => window.sessionStorage.setItem('l99_api_key', key), apiKey);
  await page.goto('/control_room.html');
  await expect(page.getByTestId('video-engine-section')).toBeVisible();
  await expect(page.getByTestId('video-engine-machine-status')).toContainText(/verified|awaiting_validation/);
  await expect(page.getByTestId('video-engine-validated')).not.toHaveText('0');
  await expect(page.getByTestId('video-engine-visual-styles')).toContainText('2/');
  await expect(page.getByTestId('video-engine-job').filter({ hasText: 'cinematic_realism' }).first()).toContainText(workspaceId);
  await expect(page.getByTestId('video-engine-job').filter({ hasText: 'watercolor_storybook' }).first()).toContainText(workspaceId);

  await page.goto(`/video_studio.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await expect(page).toHaveTitle('L99 Story Video Studio');
  await expect(page.getByTestId('video-studio')).toBeVisible();
  await expect(page.locator('#workspaceId')).toHaveValue(workspaceId);
  await expect(page.locator('#visualStyle option')).toHaveCount(Object.keys(options.visual_styles).length);
});
