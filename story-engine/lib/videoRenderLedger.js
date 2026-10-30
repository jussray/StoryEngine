// lib/videoRenderLedger.js
// Append-only evidence, lease, and budget ledger for LEEVIZE render attempts.
// Mutable renderer rows remain a read model; this ledger is the durable history.

import { randomUUID } from 'node:crypto';

import {
  createLease,
  createReceiptEvent,
  makevideoFingerprint,
  verifyReceiptEventChain
} from './makevideoProtocol.js';
import { createContinuityCookie } from './videoContinuity.js';

const RECEIPT_IMMUTABLE_ERROR = 'story video render receipt events are immutable';
const LEASE_IMMUTABLE_ERROR = 'story video render lease events are immutable';
const DEFAULT_LEASE_MS = 60_000;
const MAX_LEASE_MS = 10 * 60_000;
const MAX_BUDGET_MICROS = 1_000_000_000_000;

function text(value, fallback = '') {
  return String(value ?? '').trim() || fallback;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function safeError(error) {
  return {
    code: text(error?.code, 'OPEN_RENDER_FAILED'),
    message: text(error?.failure_receipts?.[0]?.safe_message || error?.message, 'Open render failed.').slice(0, 360),
    failure_classes: Array.isArray(error?.failure_receipts)
      ? error.failure_receipts.map(item => text(item?.failure_class)).filter(Boolean)
      : []
  };
}

function withImmediateTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function ensureVideoRenderLedgerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_video_render_attempts (
      attempt_id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL UNIQUE,
      render_id TEXT UNIQUE,
      workspace_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'render',
      request_fingerprint TEXT NOT NULL,
      continuity_cookie TEXT,
      continuity_fingerprint TEXT,
      status TEXT NOT NULL,
      recovered INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_render_attempts_job
      ON story_video_render_attempts(job_id, shot_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_render_attempts_request
      ON story_video_render_attempts(request_fingerprint, created_at DESC);

    CREATE TABLE IF NOT EXISTS story_video_render_receipt_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      render_id TEXT,
      workspace_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_fingerprint TEXT NOT NULL,
      previous_event_hash TEXT,
      event_hash TEXT NOT NULL UNIQUE,
      event_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(receipt_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_video_render_receipt_attempt
      ON story_video_render_receipt_events(attempt_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_video_render_receipt_render
      ON story_video_render_receipt_events(render_id, sequence);

    CREATE TABLE IF NOT EXISTS story_video_render_budget (
      reservation_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      currency TEXT NOT NULL,
      reserved_micros INTEGER NOT NULL,
      committed_micros INTEGER NOT NULL DEFAULT 0,
      released_micros INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS story_video_render_leases (
      subject_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      lease_fingerprint TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      released_at INTEGER,
      PRIMARY KEY(subject_id, scope)
    );

    CREATE TABLE IF NOT EXISTS story_video_render_lease_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      previous_event_fingerprint TEXT,
      event_fingerprint TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_render_lease_events_subject
      ON story_video_render_lease_events(subject_id, scope, id);

    CREATE TRIGGER IF NOT EXISTS trg_video_render_receipt_events_no_update
    BEFORE UPDATE ON story_video_render_receipt_events
    BEGIN
      SELECT RAISE(ABORT, '${RECEIPT_IMMUTABLE_ERROR}');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_video_render_receipt_events_no_delete
    BEFORE DELETE ON story_video_render_receipt_events
    BEGIN
      SELECT RAISE(ABORT, '${RECEIPT_IMMUTABLE_ERROR}');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_video_render_lease_events_no_update
    BEFORE UPDATE ON story_video_render_lease_events
    BEGIN
      SELECT RAISE(ABORT, '${LEASE_IMMUTABLE_ERROR}');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_video_render_lease_events_no_delete
    BEFORE DELETE ON story_video_render_lease_events
    BEGIN
      SELECT RAISE(ABORT, '${LEASE_IMMUTABLE_ERROR}');
    END;
  `);
}

function attemptById(db, attemptId) {
  return db.prepare('SELECT * FROM story_video_render_attempts WHERE attempt_id=?').get(attemptId) || null;
}

function attemptByRender(db, renderId) {
  return db.prepare('SELECT * FROM story_video_render_attempts WHERE render_id=?').get(renderId) || null;
}

function eventExists(db, receiptId, eventType, payloadFingerprint = null) {
  if (payloadFingerprint) {
    return Boolean(db.prepare('SELECT 1 FROM story_video_render_receipt_events WHERE receipt_id=? AND event_type=? AND payload_fingerprint=? LIMIT 1').get(receiptId, eventType, payloadFingerprint));
  }
  return Boolean(db.prepare('SELECT 1 FROM story_video_render_receipt_events WHERE receipt_id=? AND event_type=? LIMIT 1').get(receiptId, eventType));
}

function appendReceiptEventInTransaction(db, attempt, type, payload, atMs = Date.now()) {
  const last = db.prepare('SELECT sequence,event_hash FROM story_video_render_receipt_events WHERE receipt_id=? ORDER BY sequence DESC LIMIT 1').get(attempt.receipt_id);
  const event = createReceiptEvent({
    receipt_id: attempt.receipt_id,
    sequence: Number(last?.sequence || 0) + 1,
    type,
    at: new Date(atMs).toISOString(),
    payload,
    previous_event_hash: last?.event_hash || null
  });
  db.prepare(`INSERT INTO story_video_render_receipt_events (
    receipt_id,attempt_id,render_id,workspace_id,job_id,shot_id,sequence,event_type,payload_fingerprint,previous_event_hash,event_hash,event_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    attempt.receipt_id,
    attempt.attempt_id,
    attempt.render_id || null,
    attempt.workspace_id,
    attempt.job_id,
    attempt.shot_id,
    event.sequence,
    event.type,
    event.payload_fingerprint,
    event.previous_event_hash,
    event.event_hash,
    JSON.stringify(event),
    atMs
  );
  return event;
}

function ensureReceiptEventInTransaction(db, attempt, type, payload, atMs = Date.now()) {
  const payloadFingerprint = makevideoFingerprint('receipt-payload', payload || {});
  if (eventExists(db, attempt.receipt_id, type, payloadFingerprint)) return null;
  return appendReceiptEventInTransaction(db, attempt, type, payload, atMs);
}

function budgetCeilingMicros(input = {}) {
  return boundedInteger(
    input.cost_ceiling_micros ?? input.cost_ceiling?.micros,
    0,
    0,
    MAX_BUDGET_MICROS
  );
}

export function beginRenderAttempt(db, { job, shot_id, input = {}, kind = 'render' }) {
  ensureVideoRenderLedgerSchema(db);
  if (!job?.job_id || !job?.workspace_id || !shot_id) throw new TypeError('job, workspace, and shot_id are required.');
  const continuity = createContinuityCookie(job);
  const referenceFingerprint = input.reference_image_data_url
    ? makevideoFingerprint('open-render-reference', input.reference_image_data_url)
    : null;
  const reservedMicros = budgetCeilingMicros(input);
  const requestFingerprint = makevideoFingerprint('open-render-request', {
    job_id: job.job_id,
    workspace_id: job.workspace_id,
    shot_id,
    kind,
    continuity_fingerprint: continuity.fingerprint,
    attempt_ordinal: boundedInteger(input.attempt, 0, 0, 999),
    reference_fingerprint: referenceFingerprint,
    requested_timeout_ms: boundedInteger(input.timeout_ms, 0, 0, 60 * 60 * 1000),
    vendor_generation_credit_ceiling_micros: reservedMicros
  });
  const now = Date.now();
  const attempt = {
    attempt_id: `video_attempt_${randomUUID()}`,
    receipt_id: `RCP_${randomUUID()}`,
    render_id: null,
    workspace_id: job.workspace_id,
    job_id: job.job_id,
    shot_id,
    kind,
    request_fingerprint: requestFingerprint,
    continuity_cookie: continuity.value,
    continuity_fingerprint: continuity.fingerprint,
    status: 'READY',
    recovered: 0,
    created_at: now,
    updated_at: now
  };
  const reservationId = `video_budget_${randomUUID()}`;
  withImmediateTransaction(db, () => {
    db.prepare(`INSERT INTO story_video_render_attempts (
      attempt_id,receipt_id,render_id,workspace_id,job_id,shot_id,kind,request_fingerprint,continuity_cookie,continuity_fingerprint,status,recovered,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      attempt.attempt_id, attempt.receipt_id, null, attempt.workspace_id, attempt.job_id, attempt.shot_id,
      attempt.kind, attempt.request_fingerprint, attempt.continuity_cookie, attempt.continuity_fingerprint,
      attempt.status, 0, now, now
    );
    appendReceiptEventInTransaction(db, attempt, 'READY', {
      request_fingerprint: requestFingerprint,
      continuity_cookie: continuity.value,
      continuity_fingerprint: continuity.fingerprint,
      reference_fingerprint: referenceFingerprint,
      authority_granted: false
    }, now);
    db.prepare(`INSERT INTO story_video_render_budget (
      reservation_id,attempt_id,workspace_id,job_id,shot_id,scope,currency,reserved_micros,committed_micros,released_micros,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,'vendor_generation_credit','USD',?,0,0,'reserved',?,?)`).run(
      reservationId, attempt.attempt_id, attempt.workspace_id, attempt.job_id, attempt.shot_id, reservedMicros, now, now
    );
    appendReceiptEventInTransaction(db, attempt, 'BUDGET_RESERVED', {
      reservation_id: reservationId,
      scope: 'vendor_generation_credit',
      currency: 'USD',
      reserved_micros: reservedMicros,
      infrastructure_cost_accounted: false,
      authority_granted: false
    }, now);
  });
  return Object.freeze({ ...attempt, reservation_id: reservationId, reserved_micros: reservedMicros, authority_granted: false });
}

export function recordRenderSubmission(db, attemptId, render) {
  ensureVideoRenderLedgerSchema(db);
  if (!render?.render_id) throw new TypeError('render_id is required.');
  return withImmediateTransaction(db, () => {
    let attempt = attemptById(db, attemptId);
    if (!attempt) throw new Error('Render attempt ledger entry not found.');
    const now = Date.now();
    if (attempt.render_id && attempt.render_id !== render.render_id) throw new Error('Render attempt is already bound to a different render.');
    db.prepare("UPDATE story_video_render_attempts SET render_id=?,status='SUBMITTED',updated_at=? WHERE attempt_id=?").run(render.render_id, now, attempt.attempt_id);
    attempt = { ...attempt, render_id: render.render_id, status: 'SUBMITTED', updated_at: now };
    ensureReceiptEventInTransaction(db, attempt, 'SUBMITTED', {
      render_id: render.render_id,
      prompt_id: render.prompt_id || null,
      renderer: render.renderer || null,
      continuity_cookie: render.continuity_cookie || attempt.continuity_cookie,
      workflow_sha256: render.workflow_sha256 || null,
      reference_sha256: render.reference_sha256 || null,
      provider_job_id_durable: Boolean(render.prompt_id),
      authority_granted: false
    }, now);
    return attempt;
  });
}

function recoverAttemptForRender(db, render, kind = 'render') {
  ensureVideoRenderLedgerSchema(db);
  if (!render?.render_id) throw new TypeError('render_id is required.');
  const existing = attemptByRender(db, render.render_id);
  if (existing) return existing;
  const now = Date.now();
  const attempt = {
    attempt_id: `video_attempt_recovered_${randomUUID()}`,
    receipt_id: `RCP_${randomUUID()}`,
    render_id: render.render_id,
    workspace_id: render.workspace_id,
    job_id: render.job_id,
    shot_id: render.shot_id,
    kind,
    request_fingerprint: makevideoFingerprint('recovered-open-render-snapshot', {
      render_id: render.render_id,
      job_id: render.job_id,
      shot_id: render.shot_id,
      continuity_cookie: render.continuity_cookie || null,
      renderer: render.renderer || null,
      prompt_id: render.prompt_id || null
    }),
    continuity_cookie: render.continuity_cookie || null,
    continuity_fingerprint: render.continuity?.current_fingerprint || null,
    status: String(render.status || 'UNKNOWN').toUpperCase(),
    recovered: 1,
    created_at: Number(render.created_at || now),
    updated_at: now
  };
  return withImmediateTransaction(db, () => {
    const race = attemptByRender(db, render.render_id);
    if (race) return race;
    db.prepare(`INSERT INTO story_video_render_attempts (
      attempt_id,receipt_id,render_id,workspace_id,job_id,shot_id,kind,request_fingerprint,continuity_cookie,continuity_fingerprint,status,recovered,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      attempt.attempt_id, attempt.receipt_id, attempt.render_id, attempt.workspace_id, attempt.job_id, attempt.shot_id,
      attempt.kind, attempt.request_fingerprint, attempt.continuity_cookie, attempt.continuity_fingerprint,
      attempt.status, 1, attempt.created_at, now
    );
    appendReceiptEventInTransaction(db, attempt, 'RECOVERED_SNAPSHOT', {
      source: 'story_video_open_renders',
      render_id: render.render_id,
      snapshot_status: render.status || null,
      prompt_id: render.prompt_id || null,
      recovery_is_not_original_submission_proof: true,
      authority_granted: false
    }, now);
    if (render.prompt_id) appendReceiptEventInTransaction(db, attempt, 'SUBMITTED', {
      render_id: render.render_id,
      prompt_id: render.prompt_id,
      renderer: render.renderer || null,
      recovered_from_snapshot: true,
      provider_job_id_durable: true,
      authority_granted: false
    }, now);
    return attempt;
  });
}

function finalizeBudget(db, attempt, outcome) {
  return withImmediateTransaction(db, () => {
    const budget = db.prepare('SELECT * FROM story_video_render_budget WHERE attempt_id=?').get(attempt.attempt_id);
    if (!budget || budget.status === 'closed') return budget || null;
    const now = Date.now();
    const committed = 0;
    const released = Number(budget.reserved_micros || 0);
    db.prepare("UPDATE story_video_render_budget SET committed_micros=?,released_micros=?,status='closed',updated_at=? WHERE attempt_id=?").run(
      committed, released, now, attempt.attempt_id
    );
    if (outcome === 'complete') {
      ensureReceiptEventInTransaction(db, attempt, 'BUDGET_COMMITTED', {
        reservation_id: budget.reservation_id,
        scope: budget.scope,
        committed_micros: 0,
        evidence: 'self_hosted_open_weight_lane_requires_no_vendor_generation_credit',
        infrastructure_cost_accounted: false,
        authority_granted: false
      }, now);
    }
    ensureReceiptEventInTransaction(db, attempt, 'BUDGET_RELEASED', {
      reservation_id: budget.reservation_id,
      scope: budget.scope,
      released_micros: released,
      outcome,
      infrastructure_cost_accounted: false,
      authority_granted: false
    }, now);
    return db.prepare('SELECT * FROM story_video_render_budget WHERE attempt_id=?').get(attempt.attempt_id);
  });
}

export function recordRenderAttemptFailure(db, attemptId, error) {
  ensureVideoRenderLedgerSchema(db);
  const attempt = attemptById(db, attemptId);
  if (!attempt) return null;
  const failure = safeError(error);
  withImmediateTransaction(db, () => {
    const current = attemptById(db, attemptId);
    const now = Date.now();
    ensureReceiptEventInTransaction(db, current, 'FAILED', { ...failure, authority_granted: false }, now);
    db.prepare("UPDATE story_video_render_attempts SET status='FAILED',updated_at=? WHERE attempt_id=?").run(now, attemptId);
  });
  finalizeBudget(db, attemptById(db, attemptId), 'failed');
  return getRenderAttemptLedger(db, attemptId);
}

export function observeRender(db, render) {
  ensureVideoRenderLedgerSchema(db);
  let attempt = recoverAttemptForRender(db, render, render?.shot_id === '__master__' ? 'master' : 'render');
  withImmediateTransaction(db, () => {
    attempt = attemptById(db, attempt.attempt_id);
    const now = Date.now();
    const status = text(render?.status).toLowerCase();
    if (status === 'rendering') {
      ensureReceiptEventInTransaction(db, attempt, 'PROVIDER_RUNNING', {
        render_id: render.render_id,
        prompt_id: render.prompt_id || null,
        authority_granted: false
      }, now);
      db.prepare("UPDATE story_video_render_attempts SET status='RUNNING',updated_at=? WHERE attempt_id=?").run(now, attempt.attempt_id);
    }
    if (status === 'complete') {
      ensureReceiptEventInTransaction(db, attempt, 'PROVIDER_COMPLETED', {
        render_id: render.render_id,
        prompt_id: render.prompt_id || null,
        renderer: render.renderer || null,
        authority_granted: false
      }, now);
      if (render.output_sha256) ensureReceiptEventInTransaction(db, attempt, 'ASSET_PERSISTED', {
        render_id: render.render_id,
        output_fingerprint: /^sha256:/.test(render.output_sha256) ? render.output_sha256 : `sha256:${render.output_sha256}`,
        proof_cookie: render.proof_cookie || null,
        media_url: render.media_url || null,
        authority_granted: false
      }, now);
      if (render.technical_status) ensureReceiptEventInTransaction(db, attempt, 'QA_RECORDED', {
        technical_status: render.technical_status || null,
        continuity_status: render.continuity_status || null,
        editorial_status: render.editorial_status || null,
        authority_granted: false
      }, now);
      db.prepare("UPDATE story_video_render_attempts SET status='COMPLETE',updated_at=? WHERE attempt_id=?").run(now, attempt.attempt_id);
    }
    if (status === 'failed') {
      ensureReceiptEventInTransaction(db, attempt, 'FAILED', {
        render_id: render.render_id,
        source: 'renderer_snapshot',
        authority_granted: false
      }, now);
      db.prepare("UPDATE story_video_render_attempts SET status='FAILED',updated_at=? WHERE attempt_id=?").run(now, attempt.attempt_id);
    }
  });
  attempt = attemptById(db, attempt.attempt_id);
  if (attempt.status === 'COMPLETE') finalizeBudget(db, attempt, 'complete');
  if (attempt.status === 'FAILED') finalizeBudget(db, attempt, 'failed');
  return getRenderAttemptLedger(db, attempt.attempt_id);
}

export function recordRenderReview(db, render) {
  ensureVideoRenderLedgerSchema(db);
  const attempt = recoverAttemptForRender(db, render);
  withImmediateTransaction(db, () => {
    const current = attemptById(db, attempt.attempt_id);
    const now = Date.now();
    const payload = {
      technical_status: render.technical_status || null,
      continuity_status: render.continuity_status || null,
      editorial_status: render.editorial_status || null,
      notes_present: Boolean(render.review_notes),
      authority_granted: false
    };
    ensureReceiptEventInTransaction(db, current, 'REVIEW_RECORDED', payload, now);
    const approved = render.continuity_status === 'approved' && render.editorial_status === 'approved';
    db.prepare('UPDATE story_video_render_attempts SET status=?,updated_at=? WHERE attempt_id=?').run(approved ? 'APPROVED' : 'REVIEWED', now, current.attempt_id);
  });
  return getRenderAttemptLedger(db, attempt.attempt_id);
}

export function recordMasterAssembly(db, render) {
  ensureVideoRenderLedgerSchema(db);
  const attempt = recoverAttemptForRender(db, render, 'master');
  withImmediateTransaction(db, () => {
    const current = attemptById(db, attempt.attempt_id);
    const now = Date.now();
    ensureReceiptEventInTransaction(db, current, 'ASSEMBLY_COMPLETED', {
      render_id: render.render_id,
      renderer: render.renderer || null,
      continuity_cookie: render.continuity_cookie || null,
      proof_cookie: render.proof_cookie || null,
      authority_granted: false
    }, now);
    if (render.output_sha256) ensureReceiptEventInTransaction(db, current, 'ASSET_PERSISTED', {
      render_id: render.render_id,
      output_fingerprint: /^sha256:/.test(render.output_sha256) ? render.output_sha256 : `sha256:${render.output_sha256}`,
      proof_cookie: render.proof_cookie || null,
      media_url: render.media_url || null,
      authority_granted: false
    }, now);
    ensureReceiptEventInTransaction(db, current, 'QA_RECORDED', {
      technical_status: render.technical_status || null,
      continuity_status: render.continuity_status || null,
      editorial_status: render.editorial_status || null,
      release_ready: render.receipt?.release_ready === true,
      authority_granted: false
    }, now);
    db.prepare("UPDATE story_video_render_attempts SET status='ASSEMBLED',updated_at=? WHERE attempt_id=?").run(now, current.attempt_id);
  });
  return getRenderAttemptLedger(db, attempt.attempt_id);
}

function appendLeaseEventInTransaction(db, { subjectId, scope, leaseId, eventType, payload, atMs }) {
  const prior = db.prepare('SELECT event_fingerprint FROM story_video_render_lease_events WHERE subject_id=? AND scope=? ORDER BY id DESC LIMIT 1').get(subjectId, scope);
  const previous = prior?.event_fingerprint || null;
  const core = {
    subject_id: subjectId,
    scope,
    lease_id: leaseId,
    event_type: eventType,
    at: new Date(atMs).toISOString(),
    payload,
    previous_event_fingerprint: previous
  };
  const fingerprint = makevideoFingerprint('render-lease-event', core);
  db.prepare(`INSERT INTO story_video_render_lease_events (
    subject_id,scope,lease_id,event_type,previous_event_fingerprint,event_fingerprint,payload_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?)`).run(
    subjectId, scope, leaseId, eventType, previous, fingerprint, JSON.stringify({ ...core, event_fingerprint: fingerprint }), atMs
  );
  return { ...core, event_fingerprint: fingerprint };
}

export function acquireRenderLease(db, render, options = {}) {
  ensureVideoRenderLedgerSchema(db);
  const attempt = recoverAttemptForRender(db, render);
  const scope = text(options.scope, 'poll');
  const workerId = text(options.worker_id, `route-worker-${randomUUID()}`);
  const ttlMs = boundedInteger(options.ttl_ms, DEFAULT_LEASE_MS, 5_000, MAX_LEASE_MS);
  return withImmediateTransaction(db, () => {
    const now = Date.now();
    const current = db.prepare('SELECT * FROM story_video_render_leases WHERE subject_id=? AND scope=?').get(render.render_id, scope);
    if (current && !current.released_at && Number(current.expires_at) > now) {
      return { acquired: false, lease: current, authority_granted: false };
    }
    const leaseId = `video_lease_${randomUUID()}`;
    const lease = createLease({
      lease_id: leaseId,
      job_attempt_id: attempt.attempt_id,
      worker_id: workerId,
      acquired_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
      heartbeat_at: new Date(now).toISOString()
    });
    db.prepare(`INSERT INTO story_video_render_leases (
      subject_id,scope,lease_id,attempt_id,worker_id,lease_fingerprint,acquired_at,expires_at,heartbeat_at,released_at
    ) VALUES (?,?,?,?,?,?,?,?,?,NULL)
    ON CONFLICT(subject_id,scope) DO UPDATE SET
      lease_id=excluded.lease_id,
      attempt_id=excluded.attempt_id,
      worker_id=excluded.worker_id,
      lease_fingerprint=excluded.lease_fingerprint,
      acquired_at=excluded.acquired_at,
      expires_at=excluded.expires_at,
      heartbeat_at=excluded.heartbeat_at,
      released_at=NULL`).run(
      render.render_id, scope, leaseId, attempt.attempt_id, workerId, lease.fingerprint, now, now + ttlMs, now
    );
    appendLeaseEventInTransaction(db, {
      subjectId: render.render_id,
      scope,
      leaseId,
      eventType: 'ACQUIRED',
      payload: { attempt_id: attempt.attempt_id, worker_id: workerId, expires_at: now + ttlMs, lease_fingerprint: lease.fingerprint, authority_granted: false },
      atMs: now
    });
    return { acquired: true, lease: db.prepare('SELECT * FROM story_video_render_leases WHERE subject_id=? AND scope=?').get(render.render_id, scope), authority_granted: false };
  });
}

export function releaseRenderLease(db, renderId, leaseId, scope = 'poll') {
  ensureVideoRenderLedgerSchema(db);
  return withImmediateTransaction(db, () => {
    const current = db.prepare('SELECT * FROM story_video_render_leases WHERE subject_id=? AND scope=?').get(renderId, scope);
    if (!current || current.lease_id !== leaseId || current.released_at) return { released: false, authority_granted: false };
    const now = Date.now();
    db.prepare('UPDATE story_video_render_leases SET released_at=?,heartbeat_at=? WHERE subject_id=? AND scope=? AND lease_id=?').run(now, now, renderId, scope, leaseId);
    appendLeaseEventInTransaction(db, {
      subjectId: renderId,
      scope,
      leaseId,
      eventType: 'RELEASED',
      payload: { worker_id: current.worker_id, released_at: now, authority_granted: false },
      atMs: now
    });
    return { released: true, authority_granted: false };
  });
}

function verifyLeaseEventChain(rows) {
  let previous = null;
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = JSON.parse(rows[index].payload_json || '{}');
    const core = {
      subject_id: parsed.subject_id,
      scope: parsed.scope,
      lease_id: parsed.lease_id,
      event_type: parsed.event_type,
      at: parsed.at,
      payload: parsed.payload,
      previous_event_fingerprint: previous
    };
    const expected = makevideoFingerprint('render-lease-event', core);
    if (parsed.previous_event_fingerprint !== previous || parsed.event_fingerprint !== expected || rows[index].event_fingerprint !== expected) {
      return { valid: false, at: index, reason: 'lease_event_chain_mismatch' };
    }
    previous = expected;
  }
  return { valid: true, count: rows.length, head: previous };
}

export function getRenderAttemptLedger(db, attemptId) {
  ensureVideoRenderLedgerSchema(db);
  const attempt = attemptById(db, attemptId);
  if (!attempt) return null;
  const receiptRows = db.prepare('SELECT * FROM story_video_render_receipt_events WHERE attempt_id=? ORDER BY sequence ASC').all(attemptId);
  const receiptEvents = receiptRows.map(row => JSON.parse(row.event_json || '{}'));
  const receiptChain = verifyReceiptEventChain(receiptEvents);
  const budget = db.prepare('SELECT * FROM story_video_render_budget WHERE attempt_id=?').get(attemptId) || null;
  const lease = attempt.render_id ? db.prepare('SELECT * FROM story_video_render_leases WHERE subject_id=? AND scope=?').get(attempt.render_id, 'poll') || null : null;
  const leaseRows = attempt.render_id ? db.prepare('SELECT * FROM story_video_render_lease_events WHERE subject_id=? AND scope=? ORDER BY id ASC').all(attempt.render_id, 'poll') : [];
  return Object.freeze({
    contract: 'leevize/render-ledger@v1',
    immutable_receipts: true,
    attempt,
    receipt_chain: receiptChain,
    receipt_events: receiptEvents,
    budget,
    lease,
    lease_chain: verifyLeaseEventChain(leaseRows),
    authority_granted: false
  });
}

export function getRenderLedger(db, renderId) {
  ensureVideoRenderLedgerSchema(db);
  const attempt = attemptByRender(db, renderId);
  return attempt ? getRenderAttemptLedger(db, attempt.attempt_id) : null;
}

export function attachRenderLedger(db, render) {
  if (!render?.render_id) return render;
  observeRender(db, render);
  return Object.freeze({ ...render, ledger: getRenderLedger(db, render.render_id), authority_granted: false });
}
