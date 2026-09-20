import { test, expect } from '@playwright/test';
import { ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

async function createStory(request, title) {
  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title,
      genre: 'fantasy',
      pitch: 'A child follows a violet door through a storm.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  return await storyResponse.json();
}

async function addChapter(request, workspaceId, title, content, position = 0) {
  const response = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: {
      title,
      content,
      position,
      memory_patches: []
    }
  });
  expect(response.status()).toBe(201);
  return await response.json();
}

async function createJob(request, data) {
  const response = await request.post('/api/video-engine/jobs', { headers, data });
  expect(response.status()).toBe(201);
  return await response.json();
}

test('free Story Video Engine validates editable shot grammar and exports an idempotent zero-provider MP4', async ({ request }) => {
  const optionsResponse = await request.get('/api/video-engine/options', { headers });
  expect(optionsResponse.status()).toBe(200);
  const options = await optionsResponse.json();
  expect(options.modes.length).toBeGreaterThan(1);
  expect(options.visual_styles.length).toBeGreaterThan(1);
  expect(options.shot_editor.editable).toBe(true);
  expect(options.shot_editor.reorderable).toBe(true);
  expect(options.shot_editor.approved_open_render_immutable).toBe(true);
  expect(options.shot_editor.commands.length).toBeGreaterThan(1);
  expect(options.composition_profiles.clip.max_duration_seconds).toBe(60);
  expect(options.composition_profiles.video.max_duration_seconds).toBe(3600);
  expect(options.composition_profiles.movie.max_duration_seconds).toBe(21600);
  expect(options.render_router.length_strategy).toBe('verified_atomic_clips_then_ordered_composition');

  const story = await createStory(request, `Violet Door ${Date.now()}`);
  const workspaceId = story.workspace_id;
  await addChapter(request, workspaceId, 'Storm Door', 'Mina crosses the rain-soaked street. A violet door glows beneath an awning. Mina reaches for the handle.');

  const cinematicJob = await createJob(request, {
    workspace_id: workspaceId,
    mode: 'cinematic_3d',
    visual_style: 'cinematic_realism',
    quality: 'draft',
    aspect_ratio: '16:9'
  });
  expect(cinematicJob.blueprint.target_mode).toBe('cinematic_3d');
  expect(cinematicJob.blueprint.visual_style).toBe('cinematic_realism');
  expect(cinematicJob.blueprint.shot_continuity_gate.ready_for_render).toBe(true);
  expect(cinematicJob.blueprint.shots.length).toBeGreaterThan(0);
  expect(cinematicJob.blueprint.shots.every(shot => typeof shot.shot_command === 'string' && shot.shot_command.startsWith('/'))).toBe(true);

  const jobResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}`, { headers });
  expect(jobResponse.status()).toBe(200);

  const htmlResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/html`, { headers });
  expect(htmlResponse.status()).toBe(200);
  expect(htmlResponse.headers()['content-type']).toContain('text/html');
  const artifactHtml = await htmlResponse.text();
  expect(artifactHtml).toContain('data-testid="l99-video-artifact"');
  expect(artifactHtml).toContain('data-testid="video-timeline"');
  expect(artifactHtml).toContain('data-shot-command=');

  const reversed = [...cinematicJob.blueprint.shots].reverse().map((shot, index) => ({
    shot_id: shot.shot_id,
    command: index === 0 ? '/establish' : shot.shot_command
  }));
  const editResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/shot-plan`, {
    headers,
    data: { shots: reversed }
  });
  expect(editResponse.status()).toBe(200);
  const edited = await editResponse.json();
  expect(edited.status).toBe('ready_for_validation');
  expect(edited.blueprint.shot_plan_revision).toBe(1);
  expect(edited.blueprint.shots[0].shot_id).toBe(reversed[0].shot_id);
  expect(edited.blueprint.shots[0].shot_command).toBe('/establish');
  expect(edited.blueprint.shot_continuity_gate.ready_for_render).toBe(true);
  expect(edited.blueprint.shot_continuity_gate.contracts.map(item => item.SHOT_ID)).toEqual(edited.blueprint.shots.map(shot => shot.shot_id));
  for (let index = 1; index < edited.blueprint.shots.length; index += 1) {
    expect(edited.blueprint.shots[index].shot_direction.opening_frame).toBe(edited.blueprint.shots[index - 1].shot_direction.ending_frame);
  }

  const validationResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/validate`, {
    headers,
    data: {}
  });
  expect(validationResponse.status()).toBe(200);
  const validated = await validationResponse.json();
  expect(validated.status).toBe('validated');
  expect(validated.validation.passed).toBe(true);
  expect(validated.validation.playwright.passed).toBe(true);

  const renderResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/render`, {
    headers,
    data: { scene_count: 6, duration_seconds: 30, fps: 24, width: 640, height: 360 }
  });
  expect(renderResponse.status()).toBe(201);
  const rendered = await renderResponse.json();
  expect(rendered.status).toBe('complete');
  expect(rendered.scene_count).toBe(6);
  expect(rendered.duration_seconds).toBe(30);
  expect(rendered.actual_cost_usd).toBe(0);
  expect(rendered.receipt.provider_generation).toBe(false);
  expect(rendered.receipt.provider_cost_usd).toBe(0);
  expect(rendered.receipt.motion).toBe('ken_burns_zoompan');
  expect(rendered.receipt.captions.embedded).toBe(true);
  expect(rendered.receipt.voiceover.status).toBe('provider_not_configured');
  expect(rendered.reused).toBe(false);
  expect(rendered.byte_size).toBeGreaterThan(1000);

  const immutableResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/shot-plan`, {
    headers,
    data: { shots: cinematicJob.blueprint.shots.map(shot => ({ shot_id: shot.shot_id, command: shot.shot_command })) }
  });
  expect(immutableResponse.status()).toBe(409);
  await expect(immutableResponse.json()).resolves.toMatchObject({ error: 'Approved or exported shot plans are immutable. Create a new video job to change direction.' });

  const downloadResponse = await request.get(rendered.download_url, { headers });
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-type']).toContain('video/mp4');
  const mp4 = await downloadResponse.body();
  expect(mp4.length).toBe(rendered.byte_size);
  expect(mp4.subarray(4, 12).toString('ascii')).toContain('ftyp');

  const reusedResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/render`, {
    headers,
    data: { scene_count: 6, duration_seconds: 30, fps: 24, width: 640, height: 360 }
  });
  expect(reusedResponse.status()).toBe(200);
  const reused = await reusedResponse.json();
  expect(reused.reused).toBe(true);
  expect(reused.export_id).toBe(rendered.export_id);
  expect(reused.content_hash).toBe(rendered.content_hash);
});

test('live action preview passes plan proof but never claims final delivery without real footage', async ({ request }) => {
  const story = await createStory(request, `Live Action Truth ${Date.now()}`);
  const workspaceId = story.workspace_id;
  await addChapter(request, workspaceId, 'Porch', 'A creator walks from a porch toward a garden gate.');

  const liveJob = await createJob(request, {
    workspace_id: workspaceId,
    mode: 'live_action',
    visual_style: 'cinematic_realism',
    quality: 'draft',
    aspect_ratio: '16:9',
    primary_subject: 'creator',
    product_or_world: 'garden path',
    viewer_takeaway: 'The scene needs actual playable footage.',
    action_beats: ['Creator steps from the porch.', 'Creator walks toward the garden gate.']
  });
  expect(liveJob.blueprint.production_contract.playable_video_required).toBe(true);

  const validationResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(liveJob.job_id)}/validate`, {
    headers,
    data: {}
  });
  expect(validationResponse.status()).toBe(200);
  const validated = await validationResponse.json();
  expect(validated.status).toBe('preview_validated');
  expect(validated.validation.passed).toBe(true);
  expect(validated.validation.satisfies_final_delivery).toBe(false);

  const renderResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(liveJob.job_id)}/render`, {
    headers,
    data: { scene_count: 2, duration_seconds: 10, fps: 24, width: 640, height: 360 }
  });
  expect(renderResponse.status()).toBe(409);
  await expect(renderResponse.json()).resolves.toMatchObject({
    code: 'LIVE_ACTION_REAL_FOOTAGE_REQUIRED'
  });
});

test('Story Video Studio product design exposes canon, replaceable compute and separate QA gates', async ({ page }) => {
  await page.goto('/video_studio.html');
  await expect(page.getByTestId('renderer-infrastructure')).toBeVisible();
  await expect(page.getByTestId('renderer-infrastructure')).toContainText('self-hosted');
  await expect(page.getByTestId('renderer-infrastructure')).toContainText('zero-credit vendor account never blocks');
  await expect(page.getByTestId('real-footage-production')).toBeVisible();
  await expect(page.getByTestId('continuity-marker')).toContainText('never authority');
  await expect(page.getByTestId('canon-reference-image')).toBeVisible();
});
