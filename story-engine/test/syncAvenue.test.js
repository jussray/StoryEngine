import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_AVENUE_VERSION,
  compileSyncAvenue,
  explainSyncAvenue,
  renderSyncAvenueFrames
} from '../lib/syncAvenue.js';

function sharedReality() {
  return {
    origin: 'test_perception',
    entities: [
      {
        id: 'entity_a',
        kind: 'responsive_surface',
        response_channels: [
          { name: 'deformation', drivers: ['environmental_force'], min: 0, max: 1, gain: 1, attack_ms: 0, release_ms: 0 }
        ]
      },
      {
        id: 'entity_b',
        kind: 'responsive_surface',
        response_channels: [
          { name: 'deformation', drivers: ['environmental_force'], min: 0, max: 1, gain: 0.5, attack_ms: 0, release_ms: 0 }
        ]
      }
    ],
    signals: [
      {
        id: 'force_1',
        kind: 'environmental_force',
        keyframes: [
          { at_ms: 0, value: 0 },
          { at_ms: 500, value: 1 },
          { at_ms: 1000, value: 0 }
        ],
        evidence_refs: ['sensor:test-force']
      }
    ]
  };
}

test('text and voice with the same founder meaning produce the same reality state while preserving source provenance', () => {
  const base = { duration_ms: 1000, reality_perception: sharedReality() };
  const textPlan = compileSyncAvenue({
    ...base,
    founder_intent: { modality: 'text', content: 'Keep every visible response causally tied to the same real force.' }
  });
  const voicePlan = compileSyncAvenue({
    ...base,
    founder_intent: {
      modality: 'voice',
      transcript: 'Keep every visible response causally tied to the same real force.',
      audio_fingerprint: `sha256:${'a'.repeat(64)}`
    }
  });

  assert.equal(textPlan.engine_version, SYNC_AVENUE_VERSION);
  assert.equal(textPlan.status, 'COMPILED');
  assert.equal(voicePlan.status, 'COMPILED');
  assert.equal(textPlan.founder_intent.intent_semantics_fingerprint, voicePlan.founder_intent.intent_semantics_fingerprint);
  assert.equal(textPlan.world_state_fingerprint, voicePlan.world_state_fingerprint);
  assert.notEqual(textPlan.founder_intent.intent_source_fingerprint, voicePlan.founder_intent.intent_source_fingerprint);
  assert.notEqual(textPlan.receipt.receipt_fingerprint, voicePlan.receipt.receipt_fingerprint);
});

test('one cause synchronizes multiple targets through declared response channels', () => {
  const plan = compileSyncAvenue({
    duration_ms: 1000,
    founder_intent_text: 'Make the world respond together to the same cause.',
    reality_perception: sharedReality()
  });

  assert.equal(plan.status, 'COMPILED');
  assert.equal(plan.binding_count, 2);
  assert.ok(plan.bindings.every(binding => binding.synchronization_group === 'cause:force_1'));

  const sequence = renderSyncAvenueFrames(plan, { fps: 2, duration_ms: 1000 });
  const midpoint = sequence.frames.find(frame => frame.at_ms === 500);
  assert.ok(midpoint);
  assert.equal(midpoint.values['entity_a.deformation'].value, 1);
  assert.equal(midpoint.values['entity_b.deformation'].value, 0.5);
  assert.equal(midpoint.values['entity_a.deformation'].synchronization_group, midpoint.values['entity_b.deformation'].synchronization_group);
  assert.ok(sequence.output_fingerprint.startsWith('sha256:'));
});

test('Sync Avenue does not invent physics from an object name', () => {
  const plan = compileSyncAvenue({
    duration_ms: 1000,
    founder_intent_text: 'Keep motion physically grounded.',
    reality_perception: {
      entities: [{ id: 'thing_named_tree', kind: 'tree', response_channels: [] }],
      signals: [{ id: 'wind', kind: 'environmental_force', value: 1 }]
    }
  });

  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.binding_count, 0);
  assert.deepEqual(plan.blockers, ['NO_SIGNAL_TO_RESPONSE_BINDINGS']);
  assert.equal(plan.truth_contract.object_names_are_not_physics, true);
});

test('changing founder intent changes the world-state fingerprint', () => {
  const reality = sharedReality();
  const calm = compileSyncAvenue({
    duration_ms: 1000,
    founder_intent_text: 'Keep the response restrained.',
    reality_perception: reality
  });
  const intense = compileSyncAvenue({
    duration_ms: 1000,
    founder_intent_text: 'Push the response to feel forceful.',
    reality_perception: reality
  });

  assert.notEqual(calm.founder_intent.intent_semantics_fingerprint, intense.founder_intent.intent_semantics_fingerprint);
  assert.notEqual(calm.world_state_fingerprint, intense.world_state_fingerprint);
});

test('the engine can answer why a channel moved', () => {
  const plan = compileSyncAvenue({
    duration_ms: 1000,
    founder_intent_text: 'Every motion should be explainable.',
    reality_perception: sharedReality()
  });
  const explanation = explainSyncAvenue(plan, { entity_id: 'entity_a', channel_id: 'deformation' });

  assert.equal(explanation.answered, true);
  assert.equal(explanation.cause.signal_id, 'force_1');
  assert.equal(explanation.cause.kind, 'environmental_force');
  assert.equal(explanation.synchronization_group, 'cause:force_1');
  assert.match(explanation.equation, /^x\(t\)=clamp/);
  assert.deepEqual(explanation.evidence_refs, ['sensor:test-force']);
  assert.ok(explanation.explanation_fingerprint.startsWith('sha256:'));
});
