import { createHash } from 'node:crypto';

import { canonicalJson, makevideoFingerprint } from './makevideoProtocol.js';
import { log } from '../models/eventModel.js';

export const SYNC_AVENUE_VERSION = 'sync-avenue/v0.1.0';
export const SYNC_AVENUE_DEFAULT_FPS = 24;
export const SYNC_AVENUE_MAX_DURATION_MS = 10 * 60 * 1000;
export const SYNC_AVENUE_MAX_FRAME_SAMPLES = 72_000;

export const SYNC_AVENUE_TRUTH_CONTRACT = Object.freeze({
  reality_first: true,
  object_names_are_not_physics: true,
  causality_requires_signal_and_response_channel: true,
  founder_intent_semantics_affect_world_state: true,
  founder_intent_transport_does_not_change_semantics: true,
  unknown_is_not_invented: true,
  external_provider_required: false,
  renderer_authority_granted: false,
  publication_authority_granted: false
});

function text(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSorted(values = []) {
  return [...new Set(values.map(value => text(value)).filter(Boolean))].sort();
}

function fingerprintId(prefix, fingerprint) {
  return `${prefix}_${String(fingerprint).replace(/^sha256:/, '').slice(0, 20)}`;
}

function normalizeIntentInput(input = {}) {
  if (typeof input.founder_intent === 'string') {
    return { modality: 'text', content: input.founder_intent, explicit: true };
  }

  if (input.founder_intent && typeof input.founder_intent === 'object') {
    const raw = input.founder_intent;
    const modality = text(raw.modality || raw.source_type || (raw.audio_fingerprint || raw.audio_asset_id ? 'voice' : 'text')).toLowerCase();
    return {
      modality: modality === 'voice' ? 'voice' : 'text',
      content: text(raw.content || raw.text || raw.transcript),
      source_ref: text(raw.source_ref || raw.source_asset_id || raw.audio_asset_id) || null,
      audio_fingerprint: text(raw.audio_fingerprint) || null,
      explicit: true
    };
  }

  if (text(input.founder_intent_voice_transcript)) {
    return {
      modality: 'voice',
      content: text(input.founder_intent_voice_transcript),
      source_ref: text(input.founder_intent_source_ref) || null,
      audio_fingerprint: text(input.founder_intent_audio_fingerprint) || null,
      explicit: true
    };
  }

  if (text(input.founder_intent_text)) {
    return {
      modality: 'text',
      content: text(input.founder_intent_text),
      source_ref: text(input.founder_intent_source_ref) || null,
      audio_fingerprint: null,
      explicit: true
    };
  }

  if (text(input.viewer_takeaway)) {
    return {
      modality: 'text',
      content: text(input.viewer_takeaway),
      source_ref: 'input.viewer_takeaway',
      audio_fingerprint: null,
      explicit: false
    };
  }

  const beats = Array.isArray(input.action_beats) ? input.action_beats.map(value => text(value)).filter(Boolean) : [];
  if (beats.length) {
    return {
      modality: 'text',
      content: beats.join(' '),
      source_ref: 'input.action_beats',
      audio_fingerprint: null,
      explicit: false
    };
  }

  return { modality: 'text', content: '', source_ref: null, audio_fingerprint: null, explicit: false };
}

export function normalizeFounderIntent(input = {}) {
  const raw = normalizeIntentInput(input);
  const content = text(raw.content);
  const authority = raw.explicit
    ? (content ? 'FOUNDER_EXPLICIT' : 'FOUNDER_SOURCE_NEEDS_TRANSCRIPT')
    : (content ? 'INFERRED' : 'UNKNOWN');
  const status = content
    ? (raw.explicit ? 'READY' : 'INFERRED')
    : (raw.explicit && raw.modality === 'voice' ? 'NEEDS_TRANSCRIPT' : 'MISSING');
  const semantics = { content };
  const source = {
    modality: raw.modality,
    source_ref: raw.source_ref || null,
    audio_fingerprint: raw.audio_fingerprint || null,
    content
  };

  return Object.freeze({
    modality: raw.modality,
    content,
    authority,
    status,
    source_ref: raw.source_ref || null,
    audio_fingerprint: raw.audio_fingerprint || null,
    intent_semantics_fingerprint: makevideoFingerprint('sync-avenue-intent-semantics', semantics),
    intent_source_fingerprint: makevideoFingerprint('sync-avenue-intent-source', source)
  });
}

function normalizeKeyframes(signal = {}, durationMs = 1000) {
  const requested = Array.isArray(signal.keyframes) ? signal.keyframes : [];
  const fallbackValue = finite(signal.value ?? signal.magnitude, 0);
  const fallbackStart = Math.max(0, Math.round(finite(signal.start_ms, 0)));
  const fallbackEnd = Math.max(fallbackStart, Math.round(finite(signal.end_ms, durationMs)));
  const source = requested.length
    ? requested
    : [
        { at_ms: fallbackStart, value: fallbackValue },
        { at_ms: fallbackEnd, value: fallbackValue }
      ];

  const byTime = new Map();
  for (const keyframe of source) {
    const atMs = clamp(Math.round(finite(keyframe?.at_ms, 0)), 0, SYNC_AVENUE_MAX_DURATION_MS);
    byTime.set(atMs, {
      at_ms: atMs,
      value: finite(keyframe?.value, fallbackValue),
      cue: text(keyframe?.cue || keyframe?.token) || null
    });
  }
  return [...byTime.values()].sort((a, b) => a.at_ms - b.at_ms);
}

function normalizeSignal(signal = {}, index = 0, durationMs = 1000) {
  const kind = text(signal.kind || signal.type, 'unknown_signal').toLowerCase();
  const keyframes = normalizeKeyframes(signal, durationMs);
  const core = {
    signal_id: text(signal.signal_id || signal.id, `signal_${index + 1}`),
    kind,
    source_entity_id: text(signal.source_entity_id) || null,
    units: text(signal.units, 'normalized'),
    keyframes,
    evidence_refs: uniqueSorted(signal.evidence_refs || []),
    confidence: clamp(finite(signal.confidence, 1), 0, 1),
    metadata: signal.metadata && typeof signal.metadata === 'object' ? signal.metadata : {}
  };
  return Object.freeze({ ...core, fingerprint: makevideoFingerprint('sync-avenue-signal', core) });
}

function normalizeChannel(channel = {}, index = 0) {
  const min = finite(channel.min, -1);
  const max = finite(channel.max, 1);
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const baseline = clamp(finite(channel.baseline, 0), lower, upper);
  const core = {
    channel_id: text(channel.channel_id || channel.id || channel.name, `channel_${index + 1}`),
    semantic: text(channel.semantic || channel.name || channel.id, `channel_${index + 1}`).toLowerCase(),
    drivers: uniqueSorted(channel.drivers || channel.driver_kinds || []),
    units: text(channel.units, 'normalized'),
    baseline,
    gain: finite(channel.gain, 1),
    bias: finite(channel.bias, 0),
    min: lower,
    max: upper,
    attack_ms: Math.max(0, finite(channel.attack_ms, 80)),
    release_ms: Math.max(0, finite(channel.release_ms, 120)),
    evidence_refs: uniqueSorted(channel.evidence_refs || [])
  };
  return Object.freeze({ ...core, fingerprint: makevideoFingerprint('sync-avenue-channel', core) });
}

function normalizeEntity(entity = {}, index = 0) {
  const rawChannels = Array.isArray(entity.response_channels)
    ? entity.response_channels
    : Array.isArray(entity.channels)
      ? entity.channels
      : [];
  const responseChannels = rawChannels.map((channel, channelIndex) => normalizeChannel(channel, channelIndex));
  const core = {
    entity_id: text(entity.entity_id || entity.id, `entity_${index + 1}`),
    kind: text(entity.kind || entity.type, 'unknown_entity').toLowerCase(),
    response_channels: responseChannels,
    constraints: Array.isArray(entity.constraints) ? entity.constraints.map(value => text(value)).filter(Boolean) : [],
    evidence_refs: uniqueSorted(entity.evidence_refs || []),
    confidence: clamp(finite(entity.confidence, 1), 0, 1),
    metadata: entity.metadata && typeof entity.metadata === 'object' ? entity.metadata : {}
  };
  return Object.freeze({ ...core, fingerprint: makevideoFingerprint('sync-avenue-entity', core) });
}

function normalizeRelation(relation = {}, index = 0) {
  const core = {
    relation_id: text(relation.relation_id || relation.id, `relation_${index + 1}`),
    kind: text(relation.kind || relation.type, 'related_to').toLowerCase(),
    from_entity_id: text(relation.from_entity_id || relation.from) || null,
    to_entity_id: text(relation.to_entity_id || relation.to) || null,
    evidence_refs: uniqueSorted(relation.evidence_refs || []),
    confidence: clamp(finite(relation.confidence, 1), 0, 1)
  };
  return Object.freeze({ ...core, fingerprint: makevideoFingerprint('sync-avenue-relation', core) });
}

export function normalizeRealityPerception(perception = {}, options = {}) {
  const durationMs = clamp(Math.round(finite(options.duration_ms, 1000)), 1, SYNC_AVENUE_MAX_DURATION_MS);
  const entities = (Array.isArray(perception.entities) ? perception.entities : [])
    .map((entity, index) => normalizeEntity(entity, index))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  const signals = (Array.isArray(perception.signals) ? perception.signals : [])
    .map((signal, index) => normalizeSignal(signal, index, durationMs))
    .sort((a, b) => a.signal_id.localeCompare(b.signal_id));
  const relations = (Array.isArray(perception.relations) ? perception.relations : [])
    .map((relation, index) => normalizeRelation(relation, index))
    .sort((a, b) => a.relation_id.localeCompare(b.relation_id));
  const origin = text(perception.origin || options.origin, 'explicit').toLowerCase();
  const core = { origin, entities, signals, relations };
  return Object.freeze({ ...core, fingerprint: makevideoFingerprint('sync-avenue-perception', core) });
}

function buildBindings(perception) {
  const bindings = [];
  for (const signal of perception.signals) {
    for (const entity of perception.entities) {
      for (const channel of entity.response_channels) {
        if (!channel.drivers.includes(signal.kind)) continue;
        const core = {
          signal_id: signal.signal_id,
          signal_kind: signal.kind,
          entity_id: entity.entity_id,
          entity_kind: entity.kind,
          channel_id: channel.channel_id,
          channel_semantic: channel.semantic,
          mapping: {
            baseline: channel.baseline,
            gain: channel.gain,
            bias: channel.bias,
            min: channel.min,
            max: channel.max,
            attack_ms: channel.attack_ms,
            release_ms: channel.release_ms,
            units: channel.units
          },
          synchronization_group: `cause:${signal.signal_id}`,
          evidence_refs: uniqueSorted([
            ...signal.evidence_refs,
            ...entity.evidence_refs,
            ...channel.evidence_refs
          ]),
          equation: 'x(t)=clamp(smooth(x(t-dt), baseline + gain*u(t) + bias, attack, release), min, max)'
        };
        const fingerprint = makevideoFingerprint('sync-avenue-binding', core);
        bindings.push(Object.freeze({ ...core, binding_id: fingerprintId('SAB', fingerprint), fingerprint }));
      }
    }
  }
  return bindings.sort((a, b) => a.binding_id.localeCompare(b.binding_id));
}

function planStatus(intent, perception, bindings) {
  if (!perception.entities.length) return { status: 'BLOCKED', blockers: ['NO_PERCEIVED_ENTITIES'] };
  if (!perception.signals.length) return { status: 'BLOCKED', blockers: ['NO_CAUSAL_SIGNALS'] };
  if (!bindings.length) return { status: 'BLOCKED', blockers: ['NO_SIGNAL_TO_RESPONSE_BINDINGS'] };
  if (intent.status === 'READY') return { status: 'COMPILED', blockers: [] };
  if (intent.status === 'INFERRED') return { status: 'COMPILED_WITH_INFERRED_INTENT', blockers: ['FOUNDER_INTENT_NOT_EXPLICIT'] };
  return { status: 'COMPILED_WITHOUT_INTENT', blockers: ['FOUNDER_INTENT_MISSING_OR_UNTRANSCRIBED'] };
}

export function compileSyncAvenue(input = {}) {
  const durationMs = clamp(Math.round(finite(input.duration_ms, 1000)), 1, SYNC_AVENUE_MAX_DURATION_MS);
  const intent = normalizeFounderIntent(input);
  const perception = normalizeRealityPerception(input.reality_perception || input.perception || {}, {
    duration_ms: durationMs,
    origin: input.perception_origin || 'explicit'
  });
  const bindings = buildBindings(perception);
  const readiness = planStatus(intent, perception, bindings);
  const worldCore = {
    engine_version: SYNC_AVENUE_VERSION,
    truth_contract: SYNC_AVENUE_TRUTH_CONTRACT,
    intent_semantics_fingerprint: intent.intent_semantics_fingerprint,
    perception_fingerprint: perception.fingerprint,
    duration_ms: durationMs,
    entities: perception.entities,
    signals: perception.signals,
    relations: perception.relations,
    bindings
  };
  const worldStateFingerprint = makevideoFingerprint('sync-avenue-world-state', worldCore);
  const receiptCore = {
    engine_version: SYNC_AVENUE_VERSION,
    world_state_fingerprint: worldStateFingerprint,
    intent_semantics_fingerprint: intent.intent_semantics_fingerprint,
    intent_source_fingerprint: intent.intent_source_fingerprint,
    perception_fingerprint: perception.fingerprint,
    binding_fingerprints: bindings.map(binding => binding.fingerprint),
    status: readiness.status,
    blockers: readiness.blockers
  };
  const receiptFingerprint = makevideoFingerprint('sync-avenue-receipt', receiptCore);

  return Object.freeze({
    engine: 'Sync Avenue',
    engine_version: SYNC_AVENUE_VERSION,
    status: readiness.status,
    blockers: readiness.blockers,
    duration_ms: durationMs,
    founder_intent: intent,
    perception_origin: perception.origin,
    perception_fingerprint: perception.fingerprint,
    entities: perception.entities,
    signals: perception.signals,
    relations: perception.relations,
    bindings,
    binding_count: bindings.length,
    world_state_fingerprint: worldStateFingerprint,
    receipt: Object.freeze({
      ...receiptCore,
      receipt_id: fingerprintId('SAR', receiptFingerprint),
      receipt_fingerprint: receiptFingerprint,
      authority_granted: false
    }),
    truth_contract: SYNC_AVENUE_TRUTH_CONTRACT,
    authority_granted: false
  });
}

function signalValueAt(signal, atMs) {
  const frames = signal.keyframes || [];
  if (!frames.length) return 0;
  if (atMs <= frames[0].at_ms) return finite(frames[0].value, 0);
  if (atMs >= frames.at(-1).at_ms) return finite(frames.at(-1).value, 0);
  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    if (atMs > right.at_ms) continue;
    const left = frames[index - 1];
    const span = Math.max(1, right.at_ms - left.at_ms);
    const progress = clamp((atMs - left.at_ms) / span, 0, 1);
    return finite(left.value, 0) + (finite(right.value, 0) - finite(left.value, 0)) * progress;
  }
  return 0;
}

export function sampleSyncAvenueFrame(plan, atMs, previousFrame = null) {
  if (!plan || !Array.isArray(plan.bindings) || !Array.isArray(plan.signals)) {
    throw new TypeError('A compiled Sync Avenue plan is required.');
  }
  const time = clamp(Math.round(finite(atMs, 0)), 0, finite(plan.duration_ms, SYNC_AVENUE_MAX_DURATION_MS));
  const signalById = new Map(plan.signals.map(signal => [signal.signal_id, signal]));
  const previousAt = previousFrame ? finite(previousFrame.at_ms, time) : time;
  const dt = Math.max(0, time - previousAt);
  const values = {};

  for (const binding of plan.bindings) {
    const signal = signalById.get(binding.signal_id);
    if (!signal) continue;
    const key = `${binding.entity_id}.${binding.channel_id}`;
    const raw = signalValueAt(signal, time);
    const mapping = binding.mapping;
    const target = clamp(mapping.baseline + mapping.gain * raw + mapping.bias, mapping.min, mapping.max);
    const prior = previousFrame?.values?.[key]?.value ?? mapping.baseline;
    const tau = target >= prior ? mapping.attack_ms : mapping.release_ms;
    const alpha = !previousFrame || tau <= 0 ? 1 : 1 - Math.exp(-dt / Math.max(1, tau));
    const value = clamp(prior + (target - prior) * alpha, mapping.min, mapping.max);
    values[key] = Object.freeze({
      value,
      target,
      raw_signal_value: raw,
      signal_id: binding.signal_id,
      binding_id: binding.binding_id,
      synchronization_group: binding.synchronization_group,
      units: mapping.units
    });
  }

  const core = { at_ms: time, world_state_fingerprint: plan.world_state_fingerprint, values };
  return Object.freeze({ ...core, frame_fingerprint: makevideoFingerprint('sync-avenue-frame', core) });
}

export function renderSyncAvenueFrames(plan, options = {}) {
  const fps = clamp(Math.round(finite(options.fps, SYNC_AVENUE_DEFAULT_FPS)), 1, 120);
  const durationMs = clamp(Math.round(finite(options.duration_ms, plan?.duration_ms || 1000)), 1, SYNC_AVENUE_MAX_DURATION_MS);
  const requestedFrames = Math.floor((durationMs / 1000) * fps) + 1;
  if (requestedFrames > SYNC_AVENUE_MAX_FRAME_SAMPLES) {
    throw new RangeError(`Sync Avenue frame request exceeds ${SYNC_AVENUE_MAX_FRAME_SAMPLES} samples.`);
  }
  const stepMs = 1000 / fps;
  const frames = [];
  let previous = null;
  for (let index = 0; index < requestedFrames; index += 1) {
    const atMs = index === requestedFrames - 1 ? durationMs : Math.round(index * stepMs);
    previous = sampleSyncAvenueFrame(plan, atMs, previous);
    frames.push(previous);
  }
  const core = {
    engine_version: SYNC_AVENUE_VERSION,
    world_state_fingerprint: plan.world_state_fingerprint,
    fps,
    duration_ms: durationMs,
    frame_fingerprints: frames.map(frame => frame.frame_fingerprint)
  };
  return Object.freeze({
    ...core,
    frames,
    output_fingerprint: makevideoFingerprint('sync-avenue-frame-sequence', core)
  });
}

export function explainSyncAvenue(plan, selector = {}) {
  if (!plan || !Array.isArray(plan.bindings)) throw new TypeError('A compiled Sync Avenue plan is required.');
  const binding = plan.bindings.find(candidate =>
    (selector.binding_id && candidate.binding_id === selector.binding_id)
    || (selector.entity_id && selector.channel_id && candidate.entity_id === selector.entity_id && candidate.channel_id === selector.channel_id)
  );
  if (!binding) {
    return Object.freeze({
      answered: false,
      reason: 'NO_MATCHING_CAUSAL_BINDING',
      world_state_fingerprint: plan.world_state_fingerprint
    });
  }
  const signal = plan.signals.find(candidate => candidate.signal_id === binding.signal_id) || null;
  return Object.freeze({
    answered: true,
    world_state_fingerprint: plan.world_state_fingerprint,
    binding_id: binding.binding_id,
    target: { entity_id: binding.entity_id, channel_id: binding.channel_id, semantic: binding.channel_semantic },
    cause: signal ? { signal_id: signal.signal_id, kind: signal.kind, source_entity_id: signal.source_entity_id, evidence_refs: signal.evidence_refs } : null,
    synchronization_group: binding.synchronization_group,
    equation: binding.equation,
    evidence_refs: binding.evidence_refs,
    explanation_fingerprint: makevideoFingerprint('sync-avenue-explanation', { binding, signal })
  });
}

function explicitPerceptionForShot(input, shotId) {
  const perception = input?.reality_perception;
  if (!perception || typeof perception !== 'object') return null;
  if (perception.shots && typeof perception.shots === 'object' && perception.shots[shotId]) {
    return { ...perception.shots[shotId], origin: perception.shots[shotId].origin || 'explicit_shot_perception' };
  }
  if (Array.isArray(perception.entities) || Array.isArray(perception.signals)) {
    const signals = (perception.signals || []).filter(signal => !signal.shot_id || signal.shot_id === shotId);
    return { ...perception, signals, origin: perception.origin || 'explicit_shared_perception' };
  }
  return null;
}

function derivedStoryPerception(blueprint, shot) {
  const actorEntities = (blueprint.character_bible || []).map(character => ({
    id: character.character_id || character.name,
    kind: 'actor',
    confidence: 0.65,
    evidence_refs: [`story-character:${character.character_id || character.name}`],
    response_channels: [
      { name: 'body_motion', drivers: ['narrative_action'], min: 0, max: 1, attack_ms: 120, release_ms: 180 },
      { name: 'gaze_attention', drivers: ['attention'], min: 0, max: 1, attack_ms: 80, release_ms: 120 },
      { name: 'mouth_motion', drivers: ['speech_envelope', 'speech_viseme'], min: 0, max: 1, attack_ms: 30, release_ms: 45 }
    ]
  }));
  const sceneEntity = {
    id: `scene:${shot.shot_id}`,
    kind: 'scene_context',
    confidence: 0.5,
    evidence_refs: [`story-shot:${shot.shot_id}`],
    response_channels: [
      { name: 'camera_relation', drivers: ['camera_intent'], min: -1, max: 1, attack_ms: 160, release_ms: 180 }
    ]
  };
  const durationMs = Math.max(1, Math.round(finite(shot.duration_seconds, 1) * 1000));
  const signals = [
    {
      id: `action:${shot.shot_id}`,
      kind: 'narrative_action',
      value: 1,
      start_ms: 0,
      end_ms: durationMs,
      confidence: 0.5,
      evidence_refs: [`story-action:${shot.shot_id}`]
    },
    {
      id: `camera:${shot.shot_id}`,
      kind: 'camera_intent',
      value: shot.camera_move === 'static' ? 0 : 1,
      start_ms: 0,
      end_ms: durationMs,
      confidence: 0.7,
      evidence_refs: [`shot-grammar:${shot.shot_command || shot.shot_id}`]
    }
  ];
  if (text(shot.dialogue)) {
    signals.push({
      id: `speech:${shot.shot_id}`,
      kind: 'speech_envelope',
      value: 1,
      start_ms: 0,
      end_ms: durationMs,
      confidence: 0.5,
      evidence_refs: [`dialogue:${shot.shot_id}`]
    });
  }
  return {
    origin: 'derived_story_context',
    entities: [...actorEntities, sceneEntity],
    signals,
    relations: []
  };
}

export function compileStorySyncAvenue(blueprint, input = {}) {
  if (!blueprint || !Array.isArray(blueprint.shots)) throw new TypeError('A Story Video blueprint is required.');
  const founderIntent = normalizeFounderIntent(input);
  const shotPlans = blueprint.shots.map(shot => {
    const durationMs = Math.max(1, Math.round(finite(shot.duration_seconds, 1) * 1000));
    const explicit = explicitPerceptionForShot(input, shot.shot_id);
    const plan = compileSyncAvenue({
      ...input,
      duration_ms: durationMs,
      reality_perception: explicit || derivedStoryPerception(blueprint, shot),
      perception_origin: explicit ? explicit.origin : 'derived_story_context'
    });
    return Object.freeze({
      shot_id: shot.shot_id,
      status: plan.status,
      blockers: plan.blockers,
      perception_origin: plan.perception_origin,
      binding_count: plan.binding_count,
      world_state_fingerprint: plan.world_state_fingerprint,
      receipt: plan.receipt,
      signals: plan.signals,
      bindings: plan.bindings
    });
  });
  const worldStateFingerprint = makevideoFingerprint('sync-avenue-story-world', {
    engine_version: SYNC_AVENUE_VERSION,
    intent_semantics_fingerprint: founderIntent.intent_semantics_fingerprint,
    shot_world_states: shotPlans.map(plan => ({ shot_id: plan.shot_id, world_state_fingerprint: plan.world_state_fingerprint }))
  });
  const statuses = uniqueSorted(shotPlans.map(plan => plan.status));
  const envelopeCore = {
    engine_version: SYNC_AVENUE_VERSION,
    world_state_fingerprint: worldStateFingerprint,
    intent_semantics_fingerprint: founderIntent.intent_semantics_fingerprint,
    shot_receipts: shotPlans.map(plan => plan.receipt.receipt_fingerprint),
    statuses
  };
  const fingerprint = makevideoFingerprint('sync-avenue-story-envelope', envelopeCore);
  return Object.freeze({
    engine: 'Sync Avenue',
    engine_version: SYNC_AVENUE_VERSION,
    role: 'project_internal_reality_synchronization_engine',
    founder_intent: founderIntent,
    truth_contract: SYNC_AVENUE_TRUTH_CONTRACT,
    world_state_fingerprint: worldStateFingerprint,
    status: statuses.every(status => status === 'COMPILED') ? 'COMPILED' : statuses.join('+'),
    shot_plans: shotPlans,
    receipt: Object.freeze({
      ...envelopeCore,
      receipt_id: fingerprintId('SAE', fingerprint),
      receipt_fingerprint: fingerprint,
      authority_granted: false
    }),
    authority_granted: false
  });
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function syncArtifactHtml(html, envelope) {
  const marker = 'data-testid="l99-video-artifact"';
  if (!String(html).includes(marker)) return String(html);
  const attributes = `${marker} data-sync-avenue="${SYNC_AVENUE_VERSION}" data-sync-avenue-world="${envelope.world_state_fingerprint}" data-founder-intent-authority="${envelope.founder_intent.authority}"`;
  return String(html).replace(marker, attributes);
}

function hydrateJobRow(row) {
  if (!row) return null;
  return {
    ...row,
    blueprint: safeJson(row.blueprint_json, {}),
    validation: safeJson(row.validation_json, {})
  };
}

export function attachSyncAvenueToStoryVideoJob(db, job, input = {}) {
  if (!job?.job_id || !job?.blueprint) throw new TypeError('A persisted Story Video job is required.');
  const envelope = compileStorySyncAvenue(job.blueprint, input);
  const planByShot = new Map(envelope.shot_plans.map(plan => [plan.shot_id, plan]));
  const nextBlueprint = {
    ...job.blueprint,
    sync_avenue: {
      engine: envelope.engine,
      engine_version: envelope.engine_version,
      role: envelope.role,
      founder_intent: envelope.founder_intent,
      truth_contract: envelope.truth_contract,
      world_state_fingerprint: envelope.world_state_fingerprint,
      status: envelope.status,
      receipt: envelope.receipt,
      shot_plan_count: envelope.shot_plans.length
    },
    shots: (job.blueprint.shots || []).map(shot => {
      const plan = planByShot.get(shot.shot_id);
      if (!plan) return shot;
      return {
        ...shot,
        sync_avenue: {
          status: plan.status,
          blockers: plan.blockers,
          perception_origin: plan.perception_origin,
          binding_count: plan.binding_count,
          world_state_fingerprint: plan.world_state_fingerprint,
          receipt: plan.receipt,
          signals: plan.signals,
          bindings: plan.bindings
        }
      };
    })
  };

  const artifact = job.artifact_id
    ? db.prepare('SELECT artifact_id,html,metadata_json FROM story_artifacts WHERE artifact_id=?').get(job.artifact_id)
    : null;
  const nextHtml = artifact ? syncArtifactHtml(artifact.html, envelope) : null;
  const nextMetadata = artifact
    ? {
        ...safeJson(artifact.metadata_json, {}),
        sync_avenue: {
          engine_version: envelope.engine_version,
          world_state_fingerprint: envelope.world_state_fingerprint,
          founder_intent_authority: envelope.founder_intent.authority,
          receipt_fingerprint: envelope.receipt.receipt_fingerprint
        }
      }
    : null;
  const now = Date.now();

  db.transaction(() => {
    db.prepare('UPDATE story_video_jobs SET blueprint_json=?,updated_at=? WHERE job_id=?')
      .run(JSON.stringify(nextBlueprint), now, job.job_id);
    if (artifact) {
      db.prepare('UPDATE story_artifacts SET html=?,content_hash=?,metadata_json=?,updated_at=? WHERE artifact_id=?')
        .run(nextHtml, createHash('sha256').update(nextHtml).digest('hex'), JSON.stringify(nextMetadata), now, artifact.artifact_id);
    }
  })();

  log(db, {
    workspace_id: job.workspace_id,
    mode: 'video_engine',
    event_type: 'video.sync_avenue.compiled',
    payload: {
      job_id: job.job_id,
      engine_version: envelope.engine_version,
      world_state_fingerprint: envelope.world_state_fingerprint,
      founder_intent_authority: envelope.founder_intent.authority,
      shot_plan_count: envelope.shot_plans.length,
      receipt_fingerprint: envelope.receipt.receipt_fingerprint
    }
  });

  return hydrateJobRow(db.prepare('SELECT * FROM story_video_jobs WHERE job_id=?').get(job.job_id));
}

export function syncAvenueOptions() {
  return Object.freeze({
    engine: 'Sync Avenue',
    engine_version: SYNC_AVENUE_VERSION,
    role: 'project_internal_reality_synchronization_engine',
    formula: 'founder intent + perceived reality + causal signals + response channels = synchronized world state; synchronized world state + renderer = image/video',
    founder_intent_modalities: ['text', 'voice_transcript'],
    source_requirements: {
      voice_semantics_require_transcript_or_owned_transcription: true,
      perception_required_for_physical_causality: true,
      object_name_heuristics_for_physics: false
    },
    outputs: ['world_state_fingerprint', 'causal_bindings', 'control_frames', 'explanations', 'receipts'],
    truth_contract: SYNC_AVENUE_TRUTH_CONTRACT,
    authority_granted: false,
    fingerprint: makevideoFingerprint('sync-avenue-options', {
      engine_version: SYNC_AVENUE_VERSION,
      truth_contract: SYNC_AVENUE_TRUTH_CONTRACT
    })
  });
}

export function syncAvenueDebugDigest(plan) {
  return createHash('sha256').update(canonicalJson({
    engine_version: plan?.engine_version,
    world_state_fingerprint: plan?.world_state_fingerprint,
    binding_count: plan?.binding_count,
    status: plan?.status
  })).digest('hex');
}
