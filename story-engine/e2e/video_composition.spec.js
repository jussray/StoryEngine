import { test, expect } from '@playwright/test';
import { ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

test('eleven verified clips compose through the real API into a long-form MP4', async ({ request }) => {
  const optionsResponse = await request.get('/api/video-engine/options', { headers });
  expect(optionsResponse.status()).toBe(200);
  const options = await optionsResponse.json();
  expect(options.composition_profiles.clip.max_duration_seconds).toBe(60);
  expect(options.composition_profiles.video.max_duration_seconds).toBe(3600);
  expect(options.composition_profiles.movie.max_duration_seconds).toBe(21600);

  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Long Form Lantern ${Date.now()}`,
      genre: 'fantasy',
      pitch: 'A child follows a violet door through a storm.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  const chapterResponse = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: {
      title: 'The Door',
      content: 'Rain covered the street. Mina saw a violet door and stepped toward it.',
      position: 0,
      memory_patches: [{ entity_type: 'character', entity_id: 'mina', field: 'name', new_value: 'Mina' }]
    }
  });
  expect(chapterResponse.status()).toBe(201);

  const jobResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'draft',
      aspect_ratio: '16:9',
      action_beats: ['Mina approaches the violet door through the rain.']
    }
  });
  expect(jobResponse.status()).toBe(201);
  const job = await jobResponse.json();
  expect(job.blueprint.shot_continuity_gate.ready_for_render).toBe(true);

  const validationResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/validate`, {
    headers,
    data: {}
  });
  expect(validationResponse.status()).toBe(200);
  const validated = await validationResponse.json();
  expect(validated.status).toBe('validated');
  expect(validated.validation.playwright.passed).toBe(true);

  const renderResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/render`, {
    headers,
    data: { scene_count: 1, duration_seconds: 6, fps: 24, width: 320, height: 180 }
  });
  expect(renderResponse.status()).toBe(201);
  const clip = await renderResponse.json();
  expect(clip.status).toBe('complete');
  expect(clip.duration_seconds).toBe(6);

  const exportIds = Array.from({ length: 11 }, () => clip.export_id);
  const compositionResponse = await request.post('/api/video-engine/compositions', {
    headers,
    data: {
      workspace_id: workspaceId,
      profile: 'video',
      export_ids: exportIds
    }
  });
  expect(compositionResponse.status()).toBe(201);
  const composition = await compositionResponse.json();
  expect(composition.status).toBe('complete');
  expect(composition.profile).toBe('video');
  expect(composition.source_count).toBe(11);
  expect(composition.duration_seconds).toBeGreaterThan(60);
  expect(Math.abs(composition.duration_seconds - 66)).toBeLessThan(1.5);
  expect(composition.receipt.media_probe.verified).toBe(true);
  expect(composition.receipt.reencoded).toBe(false);
  expect(composition.receipt.provider_cost_usd).toBe(0);

  const downloadResponse = await request.get(composition.download_url, { headers });
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-type']).toContain('video/mp4');
  const mp4 = await downloadResponse.body();
  expect(mp4.length).toBe(composition.byte_size);
  expect(mp4.subarray(4, 12).toString('ascii')).toContain('ftyp');

  const clipLimitResponse = await request.post('/api/video-engine/compositions', {
    headers,
    data: {
      workspace_id: workspaceId,
      profile: 'clip',
      export_ids: exportIds
    }
  });
  expect(clipLimitResponse.status()).toBe(400);
  await expect(clipLimitResponse.json()).resolves.toMatchObject({
    code: 'COMPOSITION_PROFILE_LIMIT'
  });

  const repeatedResponse = await request.post('/api/video-engine/compositions', {
    headers,
    data: {
      workspace_id: workspaceId,
      profile: 'video',
      export_ids: exportIds
    }
  });
  expect(repeatedResponse.status()).toBe(200);
  const repeated = await repeatedResponse.json();
  expect(repeated.reused).toBe(true);
  expect(repeated.composition_id).toBe(composition.composition_id);
});
