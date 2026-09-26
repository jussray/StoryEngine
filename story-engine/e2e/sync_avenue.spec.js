import { test, expect } from '@playwright/test';
import { ADMIN_BOOTSTRAP_KEY } from './session.js';

const headers = { 'x-api-key': ADMIN_BOOTSTRAP_KEY, 'Content-Type': 'application/json' };

test('MAKEVIDEO routes founder intent and perceived reality through Sync Avenue before Playwright validation', async ({ request }) => {
  const optionsResponse = await request.get('/api/video-engine/sync-avenue/options', { headers });
  expect(optionsResponse.status()).toBe(200);
  const options = await optionsResponse.json();
  expect(options.engine).toBe('Sync Avenue');
  expect(options.role).toBe('project_internal_reality_synchronization_engine');
  expect(options.truth_contract.reality_first).toBe(true);
  expect(options.truth_contract.object_names_are_not_physics).toBe(true);
  expect(options.truth_contract.external_provider_required).toBe(false);

  const storyResponse = await request.post('/api/story', {
    headers,
    data: {
      title: `Sync Avenue Reality ${Date.now()}`,
      genre: 'speculative',
      pitch: 'A creator directs a scene where every visible response has a traceable cause.'
    }
  });
  expect(storyResponse.status()).toBe(201);
  const { workspace_id: workspaceId } = await storyResponse.json();

  const chapterResponse = await request.post(`/api/chapters/${encodeURIComponent(workspaceId)}`, {
    headers,
    data: {
      title: 'Cause and response',
      content: 'The subject crosses the room while the environment responds to a shared physical force.',
      position: 0,
      memory_patches: [{ entity_type: 'character', entity_id: 'subject', field: 'name', new_value: 'Subject' }]
    }
  });
  expect(chapterResponse.status()).toBe(201);

  const founderIntent = 'Make the whole scene feel alive, but every movement must answer to a real cause in the same world state.';
  const realityPerception = {
    origin: 'playwright_fixture_perception',
    entities: [
      {
        id: 'subject',
        kind: 'actor',
        evidence_refs: ['fixture:subject'],
        response_channels: [
          { name: 'body_motion', drivers: ['narrative_action'], min: 0, max: 1, attack_ms: 0, release_ms: 0 },
          { name: 'mouth_motion', drivers: ['speech_envelope'], min: 0, max: 1, attack_ms: 0, release_ms: 0 }
        ]
      },
      {
        id: 'environment_element_a',
        kind: 'responsive_material',
        evidence_refs: ['fixture:environment-a'],
        response_channels: [
          { name: 'deformation', drivers: ['environmental_force'], min: 0, max: 1, gain: 1, attack_ms: 0, release_ms: 0 }
        ]
      },
      {
        id: 'environment_element_b',
        kind: 'responsive_material',
        evidence_refs: ['fixture:environment-b'],
        response_channels: [
          { name: 'deformation', drivers: ['environmental_force'], min: 0, max: 1, gain: 0.6, attack_ms: 0, release_ms: 0 }
        ]
      }
    ],
    signals: [
      {
        id: 'action_signal',
        kind: 'narrative_action',
        keyframes: [{ at_ms: 0, value: 0 }, { at_ms: 1000, value: 1 }],
        evidence_refs: ['fixture:action']
      },
      {
        id: 'speech_signal',
        kind: 'speech_envelope',
        keyframes: [{ at_ms: 0, value: 0 }, { at_ms: 400, value: 1 }, { at_ms: 1000, value: 0 }],
        evidence_refs: ['fixture:speech']
      },
      {
        id: 'shared_force',
        kind: 'environmental_force',
        keyframes: [{ at_ms: 0, value: 0 }, { at_ms: 500, value: 1 }, { at_ms: 1000, value: 0 }],
        evidence_refs: ['fixture:force']
      }
    ]
  };

  const compileResponse = await request.post('/api/video-engine/sync-avenue/compile', {
    headers,
    data: {
      workspace_id: workspaceId,
      duration_ms: 1000,
      founder_intent: {
        modality: 'voice',
        transcript: founderIntent,
        source_ref: 'fixture:voice-intent',
        audio_fingerprint: `sha256:${'b'.repeat(64)}`
      },
      reality_perception: realityPerception
    }
  });
  expect(compileResponse.status()).toBe(200);
  const compiled = await compileResponse.json();
  expect(compiled.status).toBe('COMPILED');
  expect(compiled.founder_intent.modality).toBe('voice');
  expect(compiled.founder_intent.authority).toBe('FOUNDER_EXPLICIT');
  expect(compiled.binding_count).toBe(4);
  expect(compiled.bindings.filter(binding => binding.synchronization_group === 'cause:shared_force')).toHaveLength(2);
  expect(compiled.receipt.authority_granted).toBe(false);

  const jobResponse = await request.post('/api/video-engine/jobs', {
    headers,
    data: {
      workspace_id: workspaceId,
      mode: 'cinematic_3d',
      visual_style: 'cinematic_realism',
      quality: 'draft',
      aspect_ratio: '16:9',
      founder_intent: {
        modality: 'voice',
        transcript: founderIntent,
        source_ref: 'fixture:voice-intent',
        audio_fingerprint: `sha256:${'b'.repeat(64)}`
      },
      reality_perception: realityPerception
    }
  });
  expect(jobResponse.status()).toBe(201);
  const job = await jobResponse.json();
  expect(job.status).toBe('ready_for_validation');
  expect(job.blueprint.sync_avenue.engine).toBe('Sync Avenue');
  expect(job.blueprint.sync_avenue.role).toBe('project_internal_reality_synchronization_engine');
  expect(job.blueprint.sync_avenue.founder_intent.modality).toBe('voice');
  expect(job.blueprint.sync_avenue.founder_intent.authority).toBe('FOUNDER_EXPLICIT');
  expect(job.blueprint.sync_avenue.truth_contract.external_provider_required).toBe(false);
  expect(job.blueprint.sync_avenue.shot_plan_count).toBe(job.blueprint.shot_count);
  expect(job.blueprint.sync_avenue.renderer_bridge.bridge_version).toBe('sync-avenue-renderer-bridge/v0.1.0');
  expect(job.blueprint.sync_avenue.renderer_bridge.authority_granted).toBe(false);
  expect(job.blueprint.shots.every(shot => shot.sync_avenue.binding_count >= 4)).toBe(true);
  expect(job.blueprint.shots.every(shot => shot.sync_avenue.world_state_fingerprint.startsWith('sha256:'))).toBe(true);
  expect(job.blueprint.shots.every(shot => shot.sync_avenue.renderer_bridge.authority_granted === false)).toBe(true);
  expect(job.blueprint.shots.every(shot => shot.provider_prompt.includes('SYNC AVENUE REALITY CONTRACT'))).toBe(true);
  expect(job.blueprint.shots.every(shot => shot.provider_prompt.includes('cause:shared_force'))).toBe(true);
  expect(job.blueprint.shots.every(shot => shot.provider_prompt.includes(founderIntent))).toBe(true);

  const artifactResponse = await request.get(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/html`, { headers });
  expect(artifactResponse.status()).toBe(200);
  const artifactHtml = await artifactResponse.text();
  expect(artifactHtml).toContain('data-sync-avenue="sync-avenue/v0.1.0"');
  expect(artifactHtml).toContain(`data-sync-avenue-world="${job.blueprint.sync_avenue.world_state_fingerprint}"`);
  expect(artifactHtml).toContain('data-founder-intent-authority="FOUNDER_EXPLICIT"');

  const validateResponse = await request.post(`/api/video-engine/jobs/${encodeURIComponent(job.job_id)}/validate`, {
    headers,
    data: {}
  });
  expect(validateResponse.status()).toBe(200);
  const validated = await validateResponse.json();
  expect(validated.validation.validator).toBe('playwright_story_video_gate');
  expect(validated.validation.playwright.passed).toBe(true);
  expect(validated.validation.passed).toBe(true);
});
