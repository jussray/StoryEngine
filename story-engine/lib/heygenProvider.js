// Optional HeyGen speaking-avatar lane. The self-hosted LEEVIZE lane remains primary.
// Provider completion never grants media-verification, publication, or release authority.
import { createHash, randomUUID } from 'node:crypto';
import { createContinuityCookie } from './videoContinuity.js';

const PROVIDER = 'heygen_avatar_v3';
const BASE = 'https://api.heygen.com';
const ID = /^[a-zA-Z0-9_-]{3,200}$/;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const value = x => String(x ?? '').trim();
const problem = (code, message) => Object.assign(new Error(message), { code });

function atomic(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const outcome = operation();
    db.exec('COMMIT');
    return outcome;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function ensureHeygenSchema(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS story_video_heygen_attempts (',
    'attempt_id TEXT PRIMARY KEY,',
    'job_id TEXT NOT NULL, workspace_id TEXT NOT NULL, shot_id TEXT NOT NULL,',
    'continuity_cookie TEXT NOT NULL, request_sha256 TEXT NOT NULL,',
    'provider_video_id TEXT, status TEXT NOT NULL,',
    'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,',
    'UNIQUE(job_id, shot_id, continuity_cookie));',
    'CREATE INDEX IF NOT EXISTS idx_story_video_heygen_job',
    'ON story_video_heygen_attempts(job_id,created_at DESC);',
    'CREATE TABLE IF NOT EXISTS story_video_heygen_events (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT,',
    'attempt_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL,',
    'previous_hash TEXT, event_hash TEXT NOT NULL UNIQUE,',
    'event_json TEXT NOT NULL, created_at INTEGER NOT NULL,',
    'UNIQUE(attempt_id,sequence));',
    'CREATE TRIGGER IF NOT EXISTS trg_heygen_event_no_update',
    'BEFORE UPDATE ON story_video_heygen_events BEGIN',
    "SELECT RAISE(ABORT, 'HeyGen evidence events are immutable'); END;",
    'CREATE TRIGGER IF NOT EXISTS trg_heygen_event_no_delete',
    'BEFORE DELETE ON story_video_heygen_events BEGIN',
    "SELECT RAISE(ABORT, 'HeyGen evidence events are immutable'); END;"
  ].join(' '));
}

function appendEvent(db, row, eventType) {
  const prior = db.prepare(
    'SELECT sequence,event_hash FROM story_video_heygen_events WHERE attempt_id=? ORDER BY sequence DESC LIMIT 1'
  ).get(row.attempt_id);
  const event = {
    contract: 'story-engine/heygen-evidence@v1',
    attempt_id: row.attempt_id, job_id: row.job_id, workspace_id: row.workspace_id,
    shot_id: row.shot_id, continuity_cookie: row.continuity_cookie,
    request_sha256: row.request_sha256,
    sequence: Number(prior?.sequence || 0) + 1,
    type: eventType, provider_video_id: row.provider_video_id || null,
    previous_hash: prior?.event_hash || null, created_at: Date.now()
  };
  const serialized = JSON.stringify(event);
  const digest = sha256(Buffer.from(serialized, 'utf8'));
  db.prepare(
    'INSERT INTO story_video_heygen_events ' +
    '(attempt_id,sequence,event_type,previous_hash,event_hash,event_json,created_at) ' +
    'VALUES (?,?,?,?,?,?,?)'
  ).run(row.attempt_id, event.sequence, eventType, event.previous_hash, digest, serialized, event.created_at);
}

function display(row, job) {
  if (!row) return null;
  return {
    attempt_id: row.attempt_id, job_id: row.job_id,
    workspace_id: row.workspace_id, shot_id: row.shot_id,
    renderer: PROVIDER, status: row.status,
    provider_video_id: row.provider_video_id || null,
    request_sha256: row.request_sha256,
    continuity_cookie: row.continuity_cookie,
    continuity_current: row.continuity_cookie === createContinuityCookie(job).value,
    media_verified: false, publish_approved: false,
    authority_granted: false, cost_verified: false,
    created_at: row.created_at, updated_at: row.updated_at
  };
}

export function heygenReadiness(env = process.env) {
  const configured = Boolean(value(env.HEYGEN_API_KEY));
  const submissionEnabled = env.HEYGEN_SUBMISSIONS_ENABLED === 'true';
  return {
    provider: PROVIDER, primary_lane: false,
    configured, submission_enabled: submissionEnabled,
    ready: configured && submissionEnabled,
    may_consume_provider_credits: true,
    authority_granted: false
  };
}

function requestFor(job, input, env) {
  if (!job) throw problem('HEYGEN_JOB_NOT_FOUND', 'Story video job not found.');
  if (!['preview_validated', 'validated'].includes(job.status) || job.validation?.passed !== true) {
    throw problem('HEYGEN_PREVIEW_REQUIRED', 'Validated video plan required before paid rendering.');
  }
  if (!heygenReadiness(env).ready) {
    throw problem('HEYGEN_DISABLED', 'HeyGen is not enabled in the Story Engine runtime.');
  }
  if (input?.approve_provider_spend !== true) {
    throw problem('HEYGEN_APPROVAL_REQUIRED', 'Administrator spend acknowledgement required.');
  }
  if (value(input?.continuity_cookie) !== createContinuityCookie(job).value) {
    throw problem('HEYGEN_STALE_PLAN', 'Current continuity cookie is required.');
  }
  const shot = job.blueprint?.shots?.find(item => item.shot_id === value(input?.shot_id));
  if (!shot) throw problem('HEYGEN_SHOT_NOT_FOUND', 'Shot was not found in the current video plan.');
  const avatarId = value(input?.avatar_id), voiceId = value(input?.voice_id);
  if (!ID.test(avatarId) || !ID.test(voiceId)) {
    throw problem('HEYGEN_AVATAR_VOICE_REQUIRED', 'A valid HeyGen avatar and voice ID are required.');
  }
  const narration = value(shot.dialogue || shot.narration);
  if (narration.length < 1 || narration.length > 2500) {
    throw problem('HEYGEN_SCRIPT_INVALID', 'Shot narration must be 1–2500 characters.');
  }
  return {
    type: 'avatar', avatar_id: avatarId, voice_id: voiceId,
    script: narration, aspect_ratio: job.blueprint?.aspect_ratio || '16:9',
    resolution: '720p', output_format: 'mp4'
  };
}

async function parseResponse(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > 16384) {
    throw problem('HEYGEN_RESPONSE_TOO_LARGE', 'Provider response exceeded size limit.');
  }
  try { return JSON.parse(raw); }
  catch { throw problem('HEYGEN_RESPONSE_INVALID', 'Provider response was not valid JSON.'); }
}

function setStatus(db, attemptId, status, providerVideoId = null) {
  return atomic(db, () => {
    const current = db.prepare('SELECT * FROM story_video_heygen_attempts WHERE attempt_id=?').get(attemptId);
    if (!current) throw problem('HEYGEN_ATTEMPT_NOT_FOUND', 'Attempt was not found.');
    if (current.status === status && (!providerVideoId || providerVideoId === current.provider_video_id)) return current;
    db.prepare(
      'UPDATE story_video_heygen_attempts SET status=?,provider_video_id=COALESCE(?,provider_video_id),updated_at=? WHERE attempt_id=?'
    ).run(status, providerVideoId, Date.now(), attemptId);
    const updated = db.prepare('SELECT * FROM story_video_heygen_attempts WHERE attempt_id=?').get(attemptId);
    appendEvent(db, updated, status);
    return updated;
  });
}

export function getHeygenAttempt(db, job, attemptId) {
  ensureHeygenSchema(db);
  const row = db.prepare(
    'SELECT * FROM story_video_heygen_attempts WHERE attempt_id=? AND job_id=? AND workspace_id=?'
  ).get(attemptId, job.job_id, job.workspace_id);
  return display(row, job);
}

export async function submitHeygenShot(db, job, input = {}, options = {}) {
  const env = options.env || process.env;
  const payload = requestFor(job, input, env);
  ensureHeygenSchema(db);
  const continuityCookie = createContinuityCookie(job).value;
  const body = JSON.stringify(payload);
  const reserved = atomic(db, () => {
    const existing = db.prepare(
      'SELECT * FROM story_video_heygen_attempts WHERE job_id=? AND shot_id=? AND continuity_cookie=?'
    ).get(job.job_id, value(input.shot_id), continuityCookie);
    if (existing) {
      if (existing.request_sha256 !== sha256(Buffer.from(body, 'utf8'))) {
        throw problem('HEYGEN_REQUEST_CONFLICT', 'A different avatar or voice was already reserved for this shot.');
      }
      return { row: existing, reused: true };
    }
    const now = Date.now();
    const row = {
      attempt_id: 'heygen_' + randomUUID(), job_id: job.job_id,
      workspace_id: job.workspace_id, shot_id: value(input.shot_id),
      continuity_cookie: continuityCookie, request_sha256: sha256(Buffer.from(body, 'utf8')),
      provider_video_id: null, status: 'submitting', created_at: now, updated_at: now
    };
    db.prepare(
      'INSERT INTO story_video_heygen_attempts ' +
      '(attempt_id,job_id,workspace_id,shot_id,continuity_cookie,request_sha256,status,created_at,updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(row.attempt_id,row.job_id,row.workspace_id,row.shot_id,row.continuity_cookie,row.request_sha256,row.status,now,now);
    appendEvent(db, row, 'submitting');
    return { row, reused: false };
  });
  if (reserved.reused) return { ...display(reserved.row, job), reused: true };

  // Do not retry an ambiguous POST; it may already have incurred a provider charge.
  let row;
  try {
    const response = await (options.fetchImpl || fetch)(BASE + '/v3/videos', {
      method: 'POST',
      headers: {
        'x-api-key': value(env.HEYGEN_API_KEY),
        'content-type': 'application/json',
        'Idempotency-Key': reserved.row.attempt_id
      },
      body,
      signal: AbortSignal.timeout(20_000)
    });
    const provider = await parseResponse(response);
    const videoId = value(provider?.data?.video_id);
    if (response.ok && ID.test(videoId)) {
      row = setStatus(db, reserved.row.attempt_id, 'submitted', videoId);
    } else {
      row = setStatus(db, reserved.row.attempt_id,
        response.status >= 400 && response.status < 500 ? 'rejected' : 'needs_reconcile');
    }
  } catch {
    row = setStatus(db, reserved.row.attempt_id, 'needs_reconcile');
  }
  return { ...display(row, job), reused: false };
}

export async function refreshHeygenShot(db, job, attemptId, options = {}) {
  ensureHeygenSchema(db);
  const current = db.prepare(
    'SELECT * FROM story_video_heygen_attempts WHERE attempt_id=? AND job_id=? AND workspace_id=?'
  ).get(attemptId, job.job_id, job.workspace_id);
  if (!current) throw problem('HEYGEN_ATTEMPT_NOT_FOUND', 'Attempt was not found.');
  if (current.continuity_cookie !== createContinuityCookie(job).value) {
    throw problem('HEYGEN_STALE_PLAN', 'Attempt belongs to a superseded video plan.');
  }
  if (!ID.test(value(current.provider_video_id)) ||
      ['provider_completed_unverified', 'provider_failed', 'rejected'].includes(current.status)) {
    return display(current, job);
  }
  const env = options.env || process.env;
  if (!value(env.HEYGEN_API_KEY)) throw problem('HEYGEN_DISABLED', 'HeyGen runtime credential is unavailable.');
  try {
    const response = await (options.fetchImpl || fetch)(
      BASE + '/v3/videos/' + encodeURIComponent(current.provider_video_id), {
        headers: { 'x-api-key': value(env.HEYGEN_API_KEY) },
        signal: AbortSignal.timeout(20_000)
      });
    if (!response.ok) return display(current, job);
    const body = await parseResponse(response);
    // A mismatched provider resource cannot be treated as our previously submitted job.
    if (value(body?.data?.id) !== current.provider_video_id) return display(current, job);
    const status = value(body?.data?.status);
    if (!['completed', 'failed', 'waiting', 'processing', 'pending', 'queued'].includes(status)) {
      return display(current, job);
    }
    const next = status === 'completed' ? 'provider_completed_unverified'
      : status === 'failed' ? 'provider_failed' : 'processing';
    return display(setStatus(db, attemptId, next, current.provider_video_id), job);
  } catch {
    return display(current, job);
  }
}
