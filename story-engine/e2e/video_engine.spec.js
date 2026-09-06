import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

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
  expect(job.blueprint.aspect_ratio).toBe(look.aspect_ratio);
  expect(job.blueprint.preview_renderer).toBe('motion_book_html');
  expect(job.blueprint.cost_plan.estimated_cost_usd).toBe(0);
  expect(job.blueprint.shot_count).toBeGreaterThan(0);
  expect(job.visual_wonder.state).toBe('NOT_REQUIRED_FOR_INTERNAL_DRAFT');

  const artifactResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html`, { headers });
  expect(artifactResponse.ok()).toBe(true);
  const artifactHtml = await artifactResponse.text();
  const expectedCssRatio = {
    '16:9': '16/9',
    '9:16': '9/16',
    '1:1': '1/1',
    '4:5': '4/5'
  }[look.aspect_ratio];
  expect(artifactHtml).toContain('data-testid="l99-video-artifact"');
  expect(artifactHtml).toContain(`data-target-mode="${look.mode}"`);
  expect(artifactHtml).toContain(`data-visual-style="${look.visual_style}"`);
  expect(artifactHtml).toContain(`aspect-ratio:${expectedCssRatio}`);
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

test('free Story Video Engine validates multiple non-anime styles and gates public hero output through Visual Wonder', async ({ page, request }) => {
  const optionsResponse = await request.get('/api/video-engine/options', { headers });
  expect(optionsResponse.ok()).toBe(true);
  const options = await optionsResponse.json();
  expect(Object.keys(options.visual_styles).length).toBeGreaterThanOrEqual(10);
  expect(options.visual_styles.cinematic_realism.label).toBe('Cinematic Realism');
  expect(options.visual_styles.hand_drawn_cartoon.label).toBe('Hand-Drawn Cartoon');
  expect(options.visual_styles.watercolor_storybook.label).toBe('Watercolor Storybook');
  expect(options.visual_styles.anime.label).toBe('Anime');
  expect(options.aspect_ratios).toContain('4:5');
  expect(options.motion.policy).toBe('lowest_sufficient_motion');
  expect(options.motion.vendor_binding_allowed).toBe(false);
  expect(options.motion.ladder['1'].name).toBe('camera_motion');
  expect(options.motion.ladder['2'].name).toBe('layer_motion');
  expect(options.motion.ladder['4'].renderers).toEqual(['generative']);
  expect(options.motion.renderer_classes).toContain('ffmpeg');
  expect(options.motion.renderer_classes).toContain('generative');

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

  const blockedHero = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '9:16'
    }
  });
  expect(blockedHero.status()).toBe(400);
  await expect(blockedHero.json()).resolves.toMatchObject({
    error: expect.stringContaining('VISUAL_WONDER_REJECTED')
  });

  const visualWonder = {
    thesis: 'A girl chooses whether to follow a mysterious signal through a storm.',
    creative_mode: 'character-story',
    emotional_intent: ['wonder', 'tension'],
    visual_hook: 'A violet paper bird glows once in a rain-black street, then the whole storm seems to lean toward it.',
    scene_concept: 'Turn the invitation into a tiny impossible beacon inside a huge moving storm so the choice feels larger than the literal paper bird.',
    motion_language: 'Rain sweeps sideways, the camera pushes slowly toward the still bird, then motion briefly suspends before Nia moves.',
    human_outcome: 'Let the viewer feel the weight and possibility of choosing curiosity in uncertainty.',
    proof_truth_boundary: 'The render expresses the story source only and must not invent canon-changing events.',
    memory_line: 'Sometimes wonder asks you to move first.',
    preserves_human_agency: true,
    uses_manipulative_dark_patterns: false,
    motion_brief: {
      intent: 'wonder',
      level: 2,
      renderer: 'ffmpeg',
      selection_reason: 'Rain layers and a slow camera push create the intended wonder without requiring the character or source pixels to be regenerated.',
      focal_point: { x: 0.5, y: 0.42 },
      intensity: 0.45,
      duration_seconds: 8,
      fps: 30,
      aspect_ratio: '9:16',
      preserve: { identity: true, clothing: true, environment: true, typography: true },
      reduced_motion_fallback: true
    }
  };

  const booleanLevelHero = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '9:16',
      public_facing: true,
      visual_wonder: {
        ...visualWonder,
        motion_brief: { ...visualWonder.motion_brief, level: false, renderer: 'static' }
      }
    }
  });
  expect(booleanLevelHero.status()).toBe(400);
  await expect(booleanLevelHero.json()).resolves.toMatchObject({
    error: expect.stringContaining('motion_brief.level must be an integer from 0 through 5')
  });

  const mismatchedAspectHero = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '16:9',
      public_facing: true,
      visual_wonder: {
        ...visualWonder,
        motion_brief: { ...visualWonder.motion_brief, aspect_ratio: '4:5' }
      }
    }
  });
  expect(mismatchedAspectHero.status()).toBe(400);
  await expect(mismatchedAspectHero.json()).resolves.toMatchObject({
    error: 'MOTION_BRIEF_ASPECT_RATIO_MISMATCH',
    requested_aspect_ratio: '16:9',
    motion_brief_aspect_ratio: '4:5'
  });

  const vendorBoundHero = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '9:16',
      public_facing: true,
      visual_wonder: {
        ...visualWonder,
        motion_brief: { ...visualWonder.motion_brief, renderer: 'kling' }
      }
    }
  });
  expect(vendorBoundHero.status()).toBe(400);
  await expect(vendorBoundHero.json()).resolves.toMatchObject({
    error: expect.stringContaining('replaceable renderer class')
  });

  const fakeGenerativeHero = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '9:16',
      public_facing: true,
      visual_wonder: {
        ...visualWonder,
        motion_brief: {
          ...visualWonder.motion_brief,
          level: 4,
          renderer: 'ffmpeg'
        }
      }
    }
  });
  expect(fakeGenerativeHero.status()).toBe(400);
  await expect(fakeGenerativeHero.json()).resolves.toMatchObject({
    error: expect.stringContaining('cannot satisfy motion level 4')
  });

  const unavailableGenerativeHero = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '9:16',
      public_facing: true,
      visual_wonder: {
        ...visualWonder,
        motion_brief: {
          ...visualWonder.motion_brief,
          level: 4,
          renderer: 'generative',
          preserve: { ...visualWonder.motion_brief.preserve, identity: true }
        }
      }
    }
  });
  expect(unavailableGenerativeHero.status()).toBe(409);
  await expect(unavailableGenerativeHero.json()).resolves.toMatchObject({
    error: 'GENERATIVE_RENDERER_UNAVAILABLE',
    state: 'provider_required',
    motion_level: 4,
    required_renderer: 'generative',
    provider_generation_enabled: false
  });

  const heroResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'hero',
      aspect_ratio: '9:16',
      public_facing: true,
      visual_wonder: visualWonder
    }
  });
  expect(heroResponse.status()).toBe(201);
  const hero = await heroResponse.json();
  expect(hero.visual_wonder.state).toBe('CONCEPT_GATE_PASSED');
  expect(hero.visual_wonder.motion_brief.level).toBe(2);
  expect(hero.visual_wonder.motion_brief.level_name).toBe('layer_motion');
  expect(hero.visual_wonder.motion_brief.renderer).toBe('ffmpeg');
  expect(hero.visual_wonder.motion_brief.vendor_binding).toBeNull();
  expect(hero.visual_wonder.motion_brief.requires_generative_provider).toBe(false);
  expect(hero.visual_wonder.motion_brief.reduced_motion_fallback).toBe(true);
  expect(hero.visual_wonder.attack_2000.reasoning_pressure_budget).toBe(2000);
  expect(hero.visual_wonder.attack_2000.external_test_count_claimed).toBe(false);
  expect(hero.visual_wonder.attack_2000.lowest_sufficient_motion_required).toBe(true);
  expect(hero.visual_wonder.attack_2000.vendor_binding_forbidden).toBe(true);
  const heroArtifact = await request.get(`/api/video-engine/jobs/${encodeURIComponent(hero.job_id)}/html`, { headers });
  expect(heroArtifact.ok()).toBe(true);
  expect(await heroArtifact.text()).toContain('data-testid="l99-video-artifact"');
  const heroValidation = await request.post(`/api/video-engine/jobs/${encodeURIComponent(hero.job_id)}/validate`, { headers, data: {} });
  expect(heroValidation.status()).toBe(200);
  expect((await heroValidation.json()).validation.playwright.passed).toBe(true);

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
  await createAndValidateJob(request, workspaceId, {
    mode: 'cinematic_3d',
    visual_style: 'cinematic_realism',
    aspect_ratio: '4:5'
  });

  const listResponse = await request.get(`/api/workspaces/${encodeURIComponent(workspaceId)}/video-jobs`, { headers });
  expect(listResponse.status()).toBe(200);
  const listedJobs = await listResponse.json();
  expect(Array.isArray(listedJobs)).toBe(true);
  expect(listedJobs.length).toBeGreaterThanOrEqual(4);

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
