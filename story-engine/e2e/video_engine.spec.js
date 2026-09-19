import { test, expect } from '@playwright/test';
import {
  establishBrowserSession,
  ADMIN_BOOTSTRAP_KEY,
  CREATOR_BOOTSTRAP_KEY
} from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };
const scopedHeaders = { 'x-api-key': CREATOR_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

async function createJob(request, workspaceId, look) {
  const jobResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: look.mode,
      visual_style: look.visual_style,
      quality: 'draft',
      aspect_ratio: look.aspect_ratio,
      ...(look.extra || {})
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
  return job;
}

async function validateJob(request, job, expectedStatus = 'validated') {
  const artifactResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html`, { headers });
  expect(artifactResponse.ok()).toBe(true);
  const artifactHtml = await artifactResponse.text();
  expect(artifactHtml).toContain('data-testid="l99-video-artifact"');
  expect(artifactHtml).toContain(`data-target-mode="${job.blueprint.target_mode}"`);
  expect(artifactHtml).toContain(`data-visual-style="${job.blueprint.visual_style}"`);
  expect(artifactHtml).toContain(`data-delivery-target="${job.blueprint.production_contract.delivery_target}"`);
  if (job.blueprint.production_contract.preview_can_satisfy_delivery === false) {
    expect(artifactHtml).toContain('Final provider-rendered video required');
  } else {
    expect(artifactHtml).toContain('Provider cost: $0.00');
  }

  const validationResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/validate`, {
    headers,
    data: {}
  });
  expect(validationResponse.status()).toBe(200);
  const validated = await validationResponse.json();
  expect(validated.status).toBe(expectedStatus);
  expect(validated.validation.validator).toBe('playwright_story_video_gate');
  expect(validated.validation.playwright.passed).toBe(true);
  expect(validated.validation.structural.zero_provider_cost).toBe(true);
  expect(validated.validation.structural.has_visual_style_marker).toBe(true);
  expect(validated.validation.structural.has_delivery_target_marker).toBe(true);
  return validated;
}

async function createAndValidateJob(request, workspaceId, look) {
  return validateJob(request, await createJob(request, workspaceId, look));
}

test('free Story Video Engine validates editable shot grammar and exports an idempotent zero-provider MP4', async ({ page, request }) => {
  const optionsResponse = await request.get('/api/video-engine/options', { headers });
  expect(optionsResponse.ok()).toBe(true);
  const options = await optionsResponse.json();
  expect(Object.keys(options.visual_styles).length).toBeGreaterThanOrEqual(11);
  expect(options.production_workflow).toBe('LEEVIZE');
  expect(options.modes.live_action.label).toBe('Live Action');
  expect(options.visual_styles.bright_human_future.label).toBe('Bright Human Future');
  expect(options.visual_styles.cinematic_realism.label).toBe('Cinematic Realism');
  expect(options.visual_styles.hand_drawn_cartoon.label).toBe('Hand-Drawn Cartoon');
  expect(options.visual_styles.watercolor_storybook.label).toBe('Watercolor Storybook');
  expect(options.visual_styles.anime.label).toBe('Anime');
  expect(options.shot_editor.editable).toBe(true);
  expect(options.shot_editor.reorderable).toBe(true);
  expect(options.shot_editor.immutable_after_export).toBe(true);
  expect(options.shot_editor.commands.some(item => item.template.startsWith('/rack-focus'))).toBe(true);

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
  expect(chapterResponse.status()).toBe(201);
  await expect(chapterResponse.json()).resolves.toMatchObject({
    ok: true,
    queued: false,
    dispatch: null
  });

  const rawCinematicJob = await createJob(request, workspaceId, {
    mode: 'cinematic_3d',
    visual_style: 'cinematic_realism',
    aspect_ratio: '16:9'
  });
  expect(rawCinematicJob.blueprint.shots).toHaveLength(2);
  const [firstShot, secondShot] = rawCinematicJob.blueprint.shots;

  const editResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(rawCinematicJob.job_id)}/shot-plan`, {
    headers,
    data: {
      shots: [
        { shot_id: secondShot.shot_id, command: '/reaction Nia' },
        { shot_id: firstShot.shot_id, command: '/dolly-in Nia' }
      ]
    }
  });
  expect(editResponse.status()).toBe(200);
  const editedJob = await editResponse.json();
  expect(editedJob.status).toBe('ready_for_validation');
  expect(editedJob.validation).toEqual({});
  expect(editedJob.blueprint.shot_plan_revision).toBe(1);
  expect(editedJob.blueprint.shots[0].shot_id).toBe(secondShot.shot_id);
  expect(editedJob.blueprint.shots[0].shot_command).toBe('/reaction Nia');
  expect(editedJob.blueprint.shots[1].shot_command).toBe('/dolly-in Nia');
  expect(editedJob.blueprint.shots[1].camera_move).toBe('dolly_in');
  expect(editedJob.blueprint.shots[1].shot_direction.provider_neutral).toBe(true);
  expect(editedJob.blueprint.shot_grammar.creator_editable).toBe(true);

  const editedArtifactResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(editedJob.job_id)}/html`, { headers });
  expect(editedArtifactResponse.status()).toBe(200);
  const editedArtifactHtml = await editedArtifactResponse.text();
  expect(editedArtifactHtml).toContain('data-shot-command="/reaction Nia"');
  expect(editedArtifactHtml.indexOf('/reaction Nia')).toBeLessThan(editedArtifactHtml.indexOf('/dolly-in Nia'));

  const cinematicJob = await validateJob(request, editedJob);
  await createAndValidateJob(request, workspaceId, {
    mode: 'animation_2d',
    visual_style: 'watercolor_storybook',
    aspect_ratio: '9:16'
  });

  const liveActionRaw = await createJob(request, workspaceId, {
    mode: 'live_action',
    visual_style: 'bright_human_future',
    aspect_ratio: '9:16',
    extra: {
      primary_subject: 'founder',
      product_or_world: 'Founder Control Room',
      viewer_takeaway: 'AI can help, but the human still decides what is verified.',
      action_beats: [
        'The founder opens Founder Control Room on a laptop in a bright workspace.',
        'The founder reviews project proof and status cards over the shoulder.',
        'The founder checks a blocked state and refuses to mark it complete.',
        'The founder makes the final decision and returns to the wider bright workspace.'
      ]
    }
  });
  expect(liveActionRaw.blueprint.production_contract.workflow).toBe('LEEVIZE');
  expect(liveActionRaw.blueprint.production_contract.delivery_target).toBe('finished_playable_live_action');
  expect(liveActionRaw.blueprint.production_contract.preview_can_satisfy_delivery).toBe(false);
  expect(liveActionRaw.blueprint.production_contract.generated_visible_action_shots).toBeGreaterThanOrEqual(3);
  expect(liveActionRaw.blueprint.shots.every(shot => shot.visible_action_required === true)).toBe(true);
  expect(liveActionRaw.blueprint.shots.every(shot => shot.provider_prompt.includes('LIVE ACTION DELIVERY:'))).toBe(true);
  const liveActionPreview = await validateJob(request, liveActionRaw, 'preview_validated');
  expect(liveActionPreview.validation.final_delivery_required).toBe(true);
  expect(liveActionPreview.validation.satisfies_final_delivery).toBe(false);
  expect(liveActionPreview.validation.required_before).toBe('provider_render_and_playable_video_verification');

  const blockedLiveActionRender = await request.post(`/api/video-engine/jobs/${encodeURIComponent(liveActionPreview.job_id)}/render`, {
    headers,
    data: { scene_count: 4, duration_seconds: 20, fps: 24, width: 320, height: 180 }
  });
  expect(blockedLiveActionRender.status()).toBe(409);
  await expect(blockedLiveActionRender.json()).resolves.toMatchObject({
    error: 'Video job must pass Playwright validation before MP4 export.'
  });

  const renderResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/render`, {
    headers,
    data: { scene_count: 6, duration_seconds: 30, fps: 24, width: 320, height: 180 }
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
    data: {
      shots: cinematicJob.blueprint.shots.map(shot => ({ shot_id: shot.shot_id, command: shot.shot_command }))
    }
  });
  expect(immutableResponse.status()).toBe(409);
  await expect(immutableResponse.json()).resolves.toMatchObject({ error: 'Exported shot plans are immutable. Create a new video job to change direction.' });

  const downloadResponse = await request.get(rendered.download_url, { headers });
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-type']).toContain('video/mp4');
  const mp4 = await downloadResponse.body();
  expect(mp4.length).toBe(rendered.byte_size);
  expect(mp4.subarray(4, 12).toString('ascii')).toContain('ftyp');

  const duplicateResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(cinematicJob.job_id)}/render`, {
    headers,
    data: { scene_count: 6, duration_seconds: 30, fps: 24, width: 320, height: 180 }
  });
  expect(duplicateResponse.status()).toBe(200);
  const duplicate = await duplicateResponse.json();
  expect(duplicate.export_id).toBe(rendered.export_id);
  expect(duplicate.content_hash).toBe(rendered.content_hash);
  expect(duplicate.reused).toBe(true);

  const listResponse = await request.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/video-jobs`, { headers });
  expect(listResponse.status()).toBe(200);
  const listedJobs = await listResponse.json();
  expect(Array.isArray(listedJobs)).toBe(true);
  expect(listedJobs.length).toBeGreaterThanOrEqual(3);

  const forbiddenListResponse = await request.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/video-jobs`, {
    headers: scopedHeaders
  });
  expect(forbiddenListResponse.status()).toBe(403);
  await expect(forbiddenListResponse.json()).resolves.toMatchObject({
    error: 'workspace_forbidden',
    workspace_id: workspaceId
  });

  await establishBrowserSession(page);
  await page.goto('/control_room.html');
  await expect(page.getByTestId('video-engine-section')).toBeVisible();
  await expect(page.getByTestId('video-engine-machine-status')).toContainText(/verified|awaiting_validation|delivery_required/);
  await expect(page.getByTestId('video-engine-validated')).not.toHaveText('0');
  await expect(page.getByTestId('video-engine-visual-styles')).toContainText('3/');
  await expect(page.getByTestId('video-engine-job').filter({ hasText: 'cinematic_realism' }).first()).toContainText(workspaceId);
  await expect(page.getByTestId('video-engine-job').filter({ hasText: 'watercolor_storybook' }).first()).toContainText(workspaceId);
  await expect(page.getByTestId('video-engine-job').filter({ hasText: 'bright_human_future' }).first()).toContainText(workspaceId);

  await page.goto(`/video_studio.html?workspace_id=${encodeURIComponent(workspaceId)}`);
  await expect(page).toHaveTitle('L99 Story Video Studio');
  await expect(page.getByTestId('video-studio')).toBeVisible();
  await expect(page.locator('#workspaceId')).toHaveValue(workspaceId);
  await expect(page.locator('#visualStyle option')).toHaveCount(Object.keys(options.visual_styles).length);

  await page.getByRole('button', { name: 'Generate Production Preview' }).click();
  await expect(page.getByTestId('video-job-result')).toBeVisible();
  await expect(page.getByTestId('editable-shot-strip')).toBeVisible();
  await expect(page.getByTestId('shot-command-input')).toHaveCount(2);
  await page.getByTestId('shot-command-input').first().fill('/reaction Nia');
  await page.getByTestId('shot-move-later').first().click();
  await page.getByTestId('save-shot-plan').click();
  await expect(page.locator('#formStatus')).toContainText('Shot plan saved');
  await expect(page.getByTestId('video-job-status')).toHaveText('ready_for_validation');
  await expect(page.getByTestId('shot-plan-revision')).toContainText('r1');
  await expect(page.getByTestId('shot-command-input').nth(1)).toHaveValue('/reaction Nia');
});