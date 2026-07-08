// lib/releaseAttempts.js

import { randomUUID } from 'node:crypto';
import { assertReleaseAllowed } from './releaseGate.js';
import { log } from '../models/eventModel.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked']);

function parseResult(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function hydrate(row) {
  return row ? { ...row, result: parseResult(row.result_json) } : null;
}

function transitionError(attempt, nextStatus) {
  const error = new Error(`Cannot transition release attempt from ${attempt.status} to ${nextStatus}.`);
  error.code = 'INVALID_RELEASE_ATTEMPT_TRANSITION';
  error.attempt = attempt;
  return error;
}

function normalizeOperation(operation) {
  const value = String(operation || '').trim();
  if (!value) throw new Error('Release attempt operation is required.');
  if (value.length > 120) throw new Error('Release attempt operation is too long.');
  return value;
}

export function createReleaseAttempt(db, workspaceId, operation, options = {}) {
  const normalizedOperation = normalizeOperation(operation);
  const attemptId = randomUUID();
  const createdAt = Date.now();
  const authorization = assertReleaseAllowed(db, workspaceId, normalizedOperation, {
    allowWarning: options.allowWarning === true,
    confidenceThreshold: options.confidenceThreshold,
    p99Limit: options.p99Limit
  });

  if (!authorization.gate) return null;

  const blocked = !authorization.allowed;
  const status = blocked ? 'blocked' : 'running';
  db.prepare(`
    INSERT INTO release_attempts (
      attempt_id, workspace_id, operation, gate_status, gate_audit_id,
      status, result_json, error, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `).run(
    attemptId,
    workspaceId,
    normalizedOperation,
    authorization.gate.status,
    authorization.gate.audit_id,
    status,
    blocked ? authorization.error : null,
    createdAt,
    blocked ? createdAt : null
  );

  log(db, {
    workspace_id: workspaceId,
    mode: 'release_attempt',
    event_type: blocked ? 'release_attempt_blocked' : 'release_attempt_started',
    payload: {
      attempt_id: attemptId,
      operation: normalizedOperation,
      gate_status: authorization.gate.status,
      gate_audit_id: authorization.gate.audit_id
    },
    rollback: blocked ? 1 : 0
  });

  return {
    attempt: getReleaseAttempt(db, attemptId),
    gate: authorization.gate,
    allowed: authorization.allowed,
    error: authorization.error
  };
}

export function completeReleaseAttempt(db, attemptId, result = {}) {
  const attempt = getReleaseAttempt(db, attemptId);
  if (!attempt) return null;
  if (attempt.status === 'completed') return attempt;
  if (TERMINAL_STATUSES.has(attempt.status)) throw transitionError(attempt, 'completed');

  const completedAt = Date.now();
  db.prepare(`
    UPDATE release_attempts
    SET status = 'completed', result_json = ?, error = NULL, completed_at = ?
    WHERE attempt_id = ? AND status = 'running'
  `).run(JSON.stringify(result), completedAt, attemptId);

  log(db, {
    workspace_id: attempt.workspace_id,
    mode: 'release_attempt',
    event_type: 'release_attempt_completed',
    payload: { attempt_id: attemptId, operation: attempt.operation }
  });

  return getReleaseAttempt(db, attemptId);
}

export function failReleaseAttempt(db, attemptId, error) {
  const attempt = getReleaseAttempt(db, attemptId);
  if (!attempt) return null;
  if (attempt.status === 'failed') return attempt;
  if (TERMINAL_STATUSES.has(attempt.status)) throw transitionError(attempt, 'failed');

  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  db.prepare(`
    UPDATE release_attempts
    SET status = 'failed', error = ?, completed_at = ?
    WHERE attempt_id = ? AND status = 'running'
  `).run(message, Date.now(), attemptId);

  log(db, {
    workspace_id: attempt.workspace_id,
    mode: 'release_attempt',
    event_type: 'release_attempt_failed',
    payload: { attempt_id: attemptId, operation: attempt.operation, error: message },
    rollback: 1
  });

  return getReleaseAttempt(db, attemptId);
}

export function getReleaseAttempt(db, attemptId) {
  return hydrate(db.prepare('SELECT * FROM release_attempts WHERE attempt_id = ?').get(attemptId));
}

export function listReleaseAttempts(db, workspaceId, limit = 100) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return db.prepare(`
    SELECT * FROM release_attempts
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, boundedLimit).map(hydrate);
}

export function latestReleaseAttempt(db, workspaceId) {
  return hydrate(db.prepare(`
    SELECT * FROM release_attempts
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(workspaceId));
}
