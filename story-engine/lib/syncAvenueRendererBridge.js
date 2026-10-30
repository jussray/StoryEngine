import { makevideoFingerprint } from './makevideoProtocol.js';
import { log } from '../models/eventModel.js';

export const SYNC_AVENUE_RENDERER_BRIDGE_VERSION = 'sync-avenue-renderer-bridge/v0.1.0';

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function text(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function compactBinding(binding) {
  return `${binding.signal_kind}:${binding.signal_id} -> ${binding.entity_kind}:${binding.entity_id}.${binding.channel_semantic}`;
}

export function syncAvenueRendererDirection(shot = {}, founderIntent = {}) {
  const sync = shot.sync_avenue || {};
  const bindings = Array.isArray(sync.bindings) ? sync.bindings : [];
  const groups = new Map();
  for (const binding of bindings) {
    const group = text(binding.synchronization_group, `cause:${binding.signal_id}`);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(compactBinding(binding));
  }
  const causalLines = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, targets]) => `${group} => ${targets.sort().join(' | ')}`);
  const intent = text(founderIntent.content);
  const world = text(sync.world_state_fingerprint, 'unknown');
  const core = {
    bridge_version: SYNC_AVENUE_RENDERER_BRIDGE_VERSION,
    shot_id: shot.shot_id || null,
    world_state_fingerprint: world,
    founder_intent_semantics_fingerprint: founderIntent.intent_semantics_fingerprint || null,
    causal_lines: causalLines
  };
  const fingerprint = makevideoFingerprint('sync-avenue-renderer-direction', core);
  const direction = [
    `SYNC AVENUE REALITY CONTRACT [${fingerprint}]`,
    `World state: ${world}.`,
    intent ? `Founder intent: ${intent}` : 'Founder intent is unresolved; do not invent one.',
    causalLines.length ? `Causal synchronization: ${causalLines.join('; ')}.` : 'No verified causal bindings are available; do not invent physical reactions.',
    'Keep responses tied to the listed causes and shared synchronization groups. Do not infer physics from object names. Preserve continuity and existing shot constraints.'
  ].join('\n');
  return Object.freeze({
    bridge_version: SYNC_AVENUE_RENDERER_BRIDGE_VERSION,
    fingerprint,
    direction,
    causal_group_count: causalLines.length,
    causal_binding_count: bindings.length,
    authority_granted: false
  });
}

function hydrateJob(row) {
  if (!row) return null;
  return {
    ...row,
    blueprint: safeJson(row.blueprint_json, {}),
    validation: safeJson(row.validation_json, {})
  };
}

export function bindSyncAvenueRendererDirections(db, job) {
  if (!job?.job_id || !job?.blueprint?.sync_avenue) throw new TypeError('A Sync Avenue-enriched video job is required.');
  const founderIntent = job.blueprint.sync_avenue.founder_intent || {};
  const shots = (job.blueprint.shots || []).map(shot => {
    const bridge = syncAvenueRendererDirection(shot, founderIntent);
    const marker = `SYNC AVENUE REALITY CONTRACT [${bridge.fingerprint}]`;
    const basePrompt = String(shot.provider_prompt || shot.action || shot.narration || '').trim();
    const providerPrompt = basePrompt.includes(marker) ? basePrompt : `${basePrompt}\n\n${bridge.direction}`.trim();
    return {
      ...shot,
      provider_prompt: providerPrompt,
      sync_avenue: {
        ...(shot.sync_avenue || {}),
        renderer_bridge: bridge
      }
    };
  });
  const bridgeFingerprint = makevideoFingerprint('sync-avenue-renderer-job', {
    bridge_version: SYNC_AVENUE_RENDERER_BRIDGE_VERSION,
    world_state_fingerprint: job.blueprint.sync_avenue.world_state_fingerprint,
    directions: shots.map(shot => ({
      shot_id: shot.shot_id,
      fingerprint: shot.sync_avenue?.renderer_bridge?.fingerprint
    }))
  });
  const nextBlueprint = {
    ...job.blueprint,
    shots,
    sync_avenue: {
      ...job.blueprint.sync_avenue,
      renderer_bridge: {
        bridge_version: SYNC_AVENUE_RENDERER_BRIDGE_VERSION,
        fingerprint: bridgeFingerprint,
        shot_count: shots.length,
        authority_granted: false
      }
    }
  };
  const now = Date.now();
  db.prepare('UPDATE story_video_jobs SET blueprint_json=?,updated_at=? WHERE job_id=?')
    .run(JSON.stringify(nextBlueprint), now, job.job_id);

  log(db, {
    workspace_id: job.workspace_id,
    mode: 'video_engine',
    event_type: 'video.sync_avenue.renderer_bound',
    payload: {
      job_id: job.job_id,
      bridge_version: SYNC_AVENUE_RENDERER_BRIDGE_VERSION,
      bridge_fingerprint: bridgeFingerprint,
      world_state_fingerprint: job.blueprint.sync_avenue.world_state_fingerprint,
      shot_count: shots.length
    }
  });

  return hydrateJob(db.prepare('SELECT * FROM story_video_jobs WHERE job_id=?').get(job.job_id));
}
