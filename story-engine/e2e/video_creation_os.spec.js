import { test, expect } from '@playwright/test';
import { establishBrowserSession, ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

function fcrHandoff(overrides = {}) {
  return {
    contract: 'fcr/video-creation-handoff@v1',
    video_creation_os_contract: 'l99/video-creation-os@v1',
    workflow: 'LEEVIZE',
    target: 'story-engine/shot-dna@v1',
    subject: 'founder',
    scene: 'The founder reviews a blocked proof card, refuses a false green, and chooses the next verified action.',
    output_intent: 'cinematic founder content, clear without narration',
    selections: [
      { category: 'camera', command: '/pushin', direction: 'caller text is not trusted' },
      { category: 'angle', command: '/shoulder' },
      { category: 'composition', command: '/thirdgrid' },
      { category: 'focus', command: '/isolatefocus' },
      { category: 'color', command: '/coalteal' },
      { category: 'lighting', command: '/rimlight' }
    ],
    continuity: [
      'Founder identity and wardrobe stay consistent.',
      'Founder Control Room remains the same product world.',
      'Blocked proof must remain visibly blocked.'
    ],
    provider_neutral_prompt: 'UNTRUSTED CALLER PROMPT MUST NOT BECOME AUTHORITY',
    authority: {
      plan: true,
      render: false,
      spend: false,
      publish: false,
      merge: false,
      deploy: false,
      truth_reclassification: false
    },
    ...overrides
  };
}

test('FCR Video Creation OS handoff is consumed end to end by StoryEngine Shot DNA without authority expansion', async ({ page, request }) => {
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
  for (const command of ['/pushin', '/shoulder', '/thirdgrid', '/isolatefocus', '/coalteal', '/rimlight']) await expect(compiled).toContainText(command);
  await expect(compiled).toContainText('Preserve canon, identity, geography, continuity and truth boundaries');

  const viewport = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(viewport.body).toBeLessThanOrEqual(viewport.viewport + 1);

  const storyResponse = await request.post('/api/story', {
    headers,
    data: { title: `Video OS Proof ${Date.now()}`, genre: 'technology', pitch: 'A founder checks evidence before making the next decision.' }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  const chapterResponse = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: { title: 'Proof before motion', content: 'The founder opens the control room. One proof card is blocked, so the founder chooses the next verified action.', position: 0 }
  });
  expect(chapterResponse.status()).toBe(201);

  const invalidResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'live_action',
      visual_style: 'bright_human_future',
      video_creation_handoff: fcrHandoff({ authority: { ...fcrHandoff().authority, render: true } })
    }
  });
  expect(invalidResponse.status()).toBe(400);
  await expect(invalidResponse.json()).resolves.toMatchObject({ error: expect.stringMatching(/must not grant render authority/i) });

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
      viewer_takeaway: 'Proof comes before claims.',
      video_creation_handoff: fcrHandoff()
    }
  });
  expect(jobResponse.status()).toBe(201);
  const job = await jobResponse.json();
  expect(job.blueprint.production_contract.workflow).toBe('LEEVIZE');
  expect(job.blueprint.production_contract.video_creation_handoff_consumed).toBe(true);
  expect(job.blueprint.production_contract.video_creation_handoff_contract).toBe('fcr/video-creation-handoff@v1');
  expect(job.blueprint.production_contract.video_creation_os_contract).toBe('l99/video-creation-os@v1');
  expect(job.blueprint.production_contract.creative_handoff_grants_execution_authority).toBe(false);
  expect(job.blueprint.video_creation_handoff.authority).toEqual({
    plan: true, render: false, spend: false, publish: false, merge: false, deploy: false, truth_reclassification: false
  });
  expect(job.blueprint.shots.length).toBeGreaterThan(0);

  const expectedCommands = ['/pushin', '/shoulder', '/thirdgrid', '/isolatefocus', '/coalteal', '/rimlight'];
  for (const shot of job.blueprint.shots) {
    expect(shot.shot_direction.video_creation_os.contract).toBe('l99/video-creation-os@v1');
    expect(shot.shot_direction.video_creation_os.workflow).toBe('LEEVIZE');
    expect(shot.shot_direction.video_creation_os.subject).toBe('founder');
    expect(shot.shot_direction.video_creation_os.selections.map(item => item.command)).toEqual(expectedCommands);
    expect(shot.shot_direction.video_creation_os.selections[0].direction).toBe('controlled move toward the subject');
    expect(shot.shot_direction.video_creation_os.provider_direction).not.toContain('caller text is not trusted');
    expect(shot.provider_prompt).not.toContain('UNTRUSTED CALLER PROMPT');
    expect(shot.provider_prompt).toContain('VIDEO CREATION OS:');
    expect(shot.provider_prompt).toContain('/pushin');
    expect(shot.provider_prompt).toContain('/rimlight');
    expect(shot.provider_prompt).toContain('Blocked proof must remain visibly blocked.');
    expect(shot.provider_prompt).toContain('LIVE ACTION DELIVERY:');
  }

  const editedResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/shot-plan`, {
    headers,
    data: {
      shots: job.blueprint.shots.map((shot, index) => ({ shot_id: shot.shot_id, command: index === 0 ? '/dolly-in founder' : shot.shot_command }))
    }
  });
  expect(editedResponse.status()).toBe(200);
  const edited = await editedResponse.json();
  expect(edited.blueprint.shots[0].shot_command).toBe('/dolly-in founder');
  for (const shot of edited.blueprint.shots) {
    expect(shot.shot_direction.video_creation_os.selections.map(item => item.command)).toEqual(expectedCommands);
    expect(shot.provider_prompt).toContain('LIVE ACTION DELIVERY:');
  }
});
