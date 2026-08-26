// lib/canonEvidence.js
// Provenance and integrity contract for canon evidence.
// Evidence may describe why a claim is plausible; only explicit human authority may promote canon.

import { createHash, randomUUID } from 'node:crypto';

export const CANON_EVALUATION = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_EVALUATED: 'NOT_EVALUATED'
});

const AUTHORITIES = new Set(['human', 'import', 'system', 'ai']);

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeConfidence(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new RangeError('confidence must be a finite number between 0 and 1.');
  }
  return n;
}

function normalizeEstablishedAt(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new RangeError('established_at must be a positive integer timestamp.');
  }
  return n;
}

function normalizedPayload(input) {
  const authority = requireText(input.authority, 'authority');
  if (!AUTHORITIES.has(authority)) {
    throw new RangeError(`authority must be one of: ${[...AUTHORITIES].join(', ')}.`);
  }

  return {
    workspace_id: requireText(input.workspace_id, 'workspace_id'),
    kind: requireText(input.kind, 'kind'),
    key: requireText(input.key, 'key'),
    statement: requireText(input.statement, 'statement'),
    source_ref: requireText(input.source_ref, 'source_ref'),
    source_version: input.source_version == null ? null : requireText(input.source_version, 'source_version'),
    authority,
    confidence: normalizeConfidence(input.confidence),
    established_at: normalizeEstablishedAt(input.established_at)
  };
}

export function fingerprintCanonEvidence(input) {
  const payload = normalizedPayload(input);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function createCanonEvidence(input) {
  const payload = normalizedPayload({
    ...input,
    authority: input.authority || 'human',
    established_at: input.established_at || Date.now()
  });
  const evidence = {
    evidence_id: input.evidence_id || `ce_${randomUUID()}`,
    ...payload
  };
  requireText(evidence.evidence_id, 'evidence_id');
  return { ...evidence, fingerprint: fingerprintCanonEvidence(evidence) };
}

export function evaluateCanonEvidence(evidence) {
  if (!evidence) {
    return { status: CANON_EVALUATION.NOT_EVALUATED, reason: 'missing_evidence' };
  }

  try {
    requireText(evidence.evidence_id, 'evidence_id');
    const expected = fingerprintCanonEvidence(evidence);
    if (typeof evidence.fingerprint !== 'string' || evidence.fingerprint !== expected) {
      return { status: CANON_EVALUATION.FAIL, reason: 'fingerprint_mismatch' };
    }

    if (evidence.authority === 'ai' && evidence.confidence == null) {
      return { status: CANON_EVALUATION.NOT_EVALUATED, reason: 'ai_confidence_missing' };
    }
    if (evidence.authority === 'ai' && evidence.confidence < 0.8) {
      return { status: CANON_EVALUATION.FAIL, reason: 'ai_confidence_below_threshold' };
    }
    return { status: CANON_EVALUATION.PASS, reason: null };
  } catch (error) {
    return { status: CANON_EVALUATION.FAIL, reason: `invalid_evidence:${error.message}` };
  }
}

export function assertCanonEvidenceWritable(evidence) {
  const evaluation = evaluateCanonEvidence(evidence);
  if (evaluation.status !== CANON_EVALUATION.PASS) {
    throw new Error(`Canon evidence is not writable: ${evaluation.status}(${evaluation.reason}).`);
  }
  if (evidence.authority !== 'human') {
    throw new Error('Canon evidence is not writable: explicit human approval is required.');
  }
  return evaluation;
}
