import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANON_EVALUATION,
  createCanonEvidence,
  evaluateCanonEvidence,
  fingerprintCanonEvidence,
  assertCanonEvidenceWritable
} from '../lib/canonEvidence.js';

test('human canon evidence is provenance-backed and writable', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1',
    kind: 'character',
    key: 'eye_color',
    statement: 'green',
    source_ref: 'chapter-02:p18',
    source_version: 'sha256:abc',
    authority: 'human'
  });
  assert.match(evidence.evidence_id, /^ce_/);
  assert.strictEqual(evaluateCanonEvidence(evidence).status, CANON_EVALUATION.PASS);
  assert.strictEqual(evidence.fingerprint, fingerprintCanonEvidence(evidence));
  assert.doesNotThrow(() => assertCanonEvidenceWritable(evidence));
});

test('missing evidence is explicitly not evaluated, never green', () => {
  assert.deepStrictEqual(evaluateCanonEvidence(null), {
    status: CANON_EVALUATION.NOT_EVALUATED,
    reason: 'missing_evidence'
  });
});

test('high-confidence AI evidence can pass provenance evaluation but cannot write canon', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'world_rule', key: 'magic',
    statement: 'Magic cannot resurrect people.', source_ref: 'extract:chapter-04',
    authority: 'ai', confidence: 0.99
  });
  assert.strictEqual(evaluateCanonEvidence(evidence).status, CANON_EVALUATION.PASS);
  assert.throws(() => assertCanonEvidenceWritable(evidence), /explicit human approval/);
});

test('low-confidence AI evidence fails closed', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'world_rule', key: 'magic',
    statement: 'Magic cannot resurrect people.', source_ref: 'extract:chapter-04',
    authority: 'ai', confidence: 0.61
  });
  const evaluation = evaluateCanonEvidence(evidence);
  assert.strictEqual(evaluation.status, CANON_EVALUATION.FAIL);
  assert.strictEqual(evaluation.reason, 'ai_confidence_below_threshold');
});

test('AI evidence without confidence remains not evaluated', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'plot', key: 'reveal',
    statement: 'The reveal happens after chapter 18.', source_ref: 'outline:v3',
    authority: 'ai'
  });
  assert.strictEqual(evaluateCanonEvidence(evidence).status, CANON_EVALUATION.NOT_EVALUATED);
});

test('tampering with a signed evidence field fails fingerprint validation', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'character', key: 'name', statement: 'Maya',
    source_ref: 'review:1', authority: 'human'
  });
  const tampered = { ...evidence, statement: 'Amaya' };
  assert.deepStrictEqual(evaluateCanonEvidence(tampered), {
    status: CANON_EVALUATION.FAIL,
    reason: 'fingerprint_mismatch'
  });
  assert.throws(() => assertCanonEvidenceWritable(tampered), /not writable/);
});

test('unknown authority and malformed confidence never fall through to PASS', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'character', key: 'name', statement: 'Maya',
    source_ref: 'review:1', authority: 'human'
  });
  const unknownAuthority = { ...evidence, authority: 'robot' };
  const nanConfidence = { ...evidence, confidence: Number.NaN };
  assert.strictEqual(evaluateCanonEvidence(unknownAuthority).status, CANON_EVALUATION.FAIL);
  assert.strictEqual(evaluateCanonEvidence(nanConfidence).status, CANON_EVALUATION.FAIL);
});

test('missing statement or fingerprint never passes', () => {
  const evidence = createCanonEvidence({
    workspace_id: 'ws1', kind: 'character', key: 'name', statement: 'Maya',
    source_ref: 'review:1', authority: 'human'
  });
  assert.strictEqual(evaluateCanonEvidence({ ...evidence, statement: '' }).status, CANON_EVALUATION.FAIL);
  assert.strictEqual(evaluateCanonEvidence({ ...evidence, fingerprint: '' }).status, CANON_EVALUATION.FAIL);
});

test('fingerprint changes when authoritative statement changes', () => {
  const base = {
    workspace_id: 'ws1', kind: 'character', key: 'name',
    source_ref: 'chapter-01:p1', authority: 'human', established_at: 1770000000000
  };
  const a = createCanonEvidence({ ...base, statement: 'Maya' });
  const b = createCanonEvidence({ ...base, statement: 'Amaya' });
  assert.notStrictEqual(a.fingerprint, b.fingerprint);
});
