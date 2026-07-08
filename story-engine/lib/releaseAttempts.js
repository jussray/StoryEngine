// lib/releaseAttempts.js

import { randomUUID } from 'node:crypto';
import { assertReleaseAllowed } from './releaseGate.js';
import { log } from '../models/eventModel.js';

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

export function createReleaseAttempt(db, workspaceId, operation, options = {}) {
  const attemptId = randomUUID();
  const createdAt = Date.now();
  const authorization = assertReleaseAllowed(db, workspaceId, operation, {
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
    operation,
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
      operation,
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
  const completedAt = Date.now();
  db.prepare(`
    UPDATE release_attempts
    SET status = 'completed', result_json = ?, error = NULL, completed_at = ?
    WHERE attempt_id = ?
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
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  db.prepare(`
    UPDATE release_attempts
    SET status = 'failed', error = ?, completed_at = ?
    WHERE attempt_id = ?
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
  return db.prepare(`
    SELECT * FROM release_attempts
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit).map(hydrate);
}

export function latestReleaseAttempt(db, workspaceId) {
  return hydrate(db.prepare(`
    SELECT * FROM release_attempts
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(workspaceId));
}
