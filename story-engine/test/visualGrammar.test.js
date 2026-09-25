import test from 'node:test';
import assert from 'node:assert/strict';

import { createJobSpec } from '../lib/makevideoProtocol.js';
import {
  VISUAL_MODES,
  bindVisualGrammarToJobSpec,
  createVisualGrammarSelection,
  inferVisualMode
} from '../lib/visualGrammar.js';

test('visual grammar exposes exactly the 14 approved structures', () => {
  assert.deepEqual(VISUAL_MODES, [
    'handwritten',
    'decision_matrix',
    'infographic',
    'canvas',
    'layers',
    'cycle',
    'diagram',
    'roadmap',
    'sketchnotes',
    'iceberg',
    'blueprint',
    'exploded_view',
    'tree',
    'timeline'
  ]);
});

test('intent selects the smallest useful visual structure instead of decorating by default', () => {
  assert.equal(inferVisualMode('Compare three launch options against cost, speed, and proof'), 'decision_matrix');
  assert.equal(inferVisualMode('Show the hidden root causes beneath the visible symptom'), 'iceberg');
  assert.equal(inferVisualMode('A cinematic portrait with no explanatory structure'), null);
});

test('image and video share the same primary mode while video receives a reveal behavior', () => {
  const image = createVisualGrammarSelection({
    assetKind: 'image',
    intent: 'Show the product parts and how they fit together',
    truthClass: 'ILLUSTRATIVE'
  });
  const video = createVisualGrammarSelection({
    assetKind: 'video',
    mode: 'exploded view',
    intent: 'Show the product parts and how they fit together',
    truthClass: 'ILLUSTRATIVE'
  });

  assert.equal(image.mode, 'exploded_view');
  assert.equal(image.video_reveal, null);
  assert.equal(video.mode, 'exploded_view');
  assert.equal(video.video_reveal, 'disassemble_reassemble');
  assert.equal(video.structure_grants_truth_or_authority, false);
  assert.equal(video.authority_granted, false);
});

test('selection fingerprint changes when the mode or rationale changes', () => {
  const first = createVisualGrammarSelection({ assetKind: 'image', mode: 'diagram', intent: 'Explain the system', rationale: 'Relationships matter.' });
  const second = createVisualGrammarSelection({ assetKind: 'image', mode: 'blueprint', intent: 'Explain the system', rationale: 'Build plan matters.' });
  const third = createVisualGrammarSelection({ assetKind: 'image', mode: 'diagram', intent: 'Explain the system', rationale: 'Flow matters.' });

  assert.match(first.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, third.fingerprint);
});

test('visual grammar is embedded in immutable render input so job identity changes with the visual choice', () => {
  const base = {
    objective_id: 'OBJ_VISUAL_001',
    job_kind: 'IMAGE_RENDER',
    immutable_job_spec: { prompt: 'Explain the launch system' },
    adapter_id: 'renderer',
    adapter_version: '1',
    expected_outputs: ['IMAGE']
  };
  const diagram = createVisualGrammarSelection({ assetKind: 'image', mode: 'diagram', intent: 'Explain the launch system' });
  const timeline = createVisualGrammarSelection({ assetKind: 'image', mode: 'timeline', intent: 'Explain the launch system' });

  const diagramJob = createJobSpec(bindVisualGrammarToJobSpec(base, diagram));
  const timelineJob = createJobSpec(bindVisualGrammarToJobSpec(base, timeline));

  assert.equal(diagramJob.immutable_job_spec.visual_grammar.mode, 'diagram');
  assert.notEqual(diagramJob.idempotency_key, timelineJob.idempotency_key);
});

test('composition guard permits one supporting structure but rejects mode soup', () => {
  const selection = createVisualGrammarSelection({
    assetKind: 'video',
    mode: 'roadmap',
    supportingModes: ['timeline'],
    intent: 'Show phased future delivery with dated gates'
  });
  assert.deepEqual(selection.supporting_modes, ['timeline']);

  assert.throws(
    () => createVisualGrammarSelection({ assetKind: 'image', mode: 'diagram', supportingModes: ['timeline', 'tree'] }),
    /at most one supporting visual mode/i
  );
});
