import { test, expect } from '@playwright/test';
import { establishBrowserSession, ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

test('Video Creation OS is a standalone nine-layer creator tool and compiles into StoryEngine Shot DNA', async ({ page, request }) => {
  await establishBrowserSession(page);
  await page.goto('/video_creation_os.html');
  await expect(page).toHaveTitle('Video Creation OS | StoryEngine');
  await expect(page.getByTestId('video-creation-os')).toHaveAttribute('data-contract', 'l99/video-creation-os@v1');
  await expect(page.getByTestId('core-formula')).toContainText('SUBJECT + SCENE + CAMERA + ANGLE + ACTION + COMPOSITION + EFFECT + FOCUS + COLOR + LIGHTING + OUTPUT INTENT');
  await expect(page.locator('[data-category]')).toHaveCount(9);

  await page.locator('[data-category="camera"]').selectOption('/pushin');
  await page.locator('[data-category="angle"]').selectOption('/shoulder');
  await page.locator('[data-category="composition"]').selectOption('/thirdgrid');
  await page.locator('[data-category="focus"]').selectOption('/isolatefocus');
  await page.locator('[data-category="color"]').selectOption('/coalteal');
  await page.locator('[data-category="lighting"]').selectOption('/rimlight');
  await page.getByRole('button', { name: 'Compile shot direction' }).click();
  const compiled = page.getByTestId('compiled-output');
  await expect(compiled).toContainText('/pushin');
  await expect(compiled).toContainText('/shoulder');
  await expect(compiled).toContainText('/thirdgrid');
  await expect(compiled).toContainText('/isolatefocus');
  await expect(compiled).toContainText('/coalteal');
  await expect(compiled).toContainText('/rimlight');
  await expect(compiled).toContainText('Preserve canon, identity, geography, continuity and truth boundaries');

  const viewport = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(viewport.body).toBeLessThanOrEqual(viewport.viewport + 1);

  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Video OS Proof ${Date.now()}`,
      genre: 'technology',
      pitch: 'A founder checks evidence before making the next decision.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  const chapterResponse = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: {
      title: 'Proof before motion',
      content: 'The founder opens the control room. One proof card is blocked, so the founder chooses the next verified action.',
      position: 0
    }
  });
  expect(chapterResponse.status()).toBe(201);

  const jobResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'live_action',
      visual_style: 'bright_human_future',
      quality: 'draft',
      aspect_ratio: '9:16',
      primary_subject: 'founder',
      product_or_world: 'Founder Control Room',
      viewer_takeaway: 'Proof comes before claims.'
    }
  });
  expect(jobResponse.status()).toBe(201);
  const job = await jobResponse.json();
  expect(job.blueprint.production_contract.workflow).toBe('LEEVIZE');
  expect(job.blueprint.shots.length).toBeGreaterThan(0);

  for (const shot of job.blueprint.shots) {
    expect(shot.shot_direction.video_creation_os.contract).toBe('l99/video-creation-os@v1');
    expect(shot.shot_direction.video_creation_os.workflow).toBe('LEEVIZE');
    expect(shot.shot_direction.video_creation_os.formula).toEqual([
      'subject', 'scene', 'camera', 'angle', 'action', 'composition', 'effect', 'focus', 'color', 'lighting', 'output_intent'
    ]);
    expect(shot.shot_direction.video_creation_os.authority).toEqual({
      plan: true,
      render: false,
      spend: false,
      publish: false,
      truth_reclassification: false
    });
    expect(shot.provider_prompt).toContain('VIDEO CREATION OS:');
    expect(shot.provider_prompt).toContain('Preserve canon, identity, geography, continuity and truth boundaries.');
  }
});
