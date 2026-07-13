/**
 * companionLogger.js — Batch 2, Companion Pipeline Observability (Node)
 *
 * Append-only logger for every companion AI request in the story-engine.
 * No message body is ever stored. Retries are new rows.
 * Service-role-only Supabase insert — never called from client code.
 * Fails closed: companion call completes even if logging throws.
 *
 * Governed by: GLOBAL_AI.md, schemas/companion_requests.schema.json
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const VALID_COMPANIONS = new Set(['raylene', 'rylane', 'cloud', 'night', 'oracle']);
const VALID_FALLBACK_REASONS = new Set([
  'api_error_500', 'api_timeout', 'api_rate_limit',
  'network_offline', 'safety_block', 'budget_exceeded',
]);

const FALLBACK_ENABLED =
  (process.env.COMPANION_GHOST_FALLBACK_ENABLED ?? 'true') === 'true';

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[companionLogger] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
    return null;
  }
  _supabase = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _supabase;
}

/**
 * Validate a row against the schema before insert.
 * Throws on violation so the caller can handle before hitting the DB.
 */
function validate(row) {
  if (!row.user_id) throw new Error('user_id required');
  if (!row.tenant_id) throw new Error('tenant_id required');
  if (!row.session_id) throw new Error('session_id required');
  if (!VALID_COMPANIONS.has(row.companion_id))
    throw new Error(`Unknown companion_id: ${row.companion_id}`);
  if (!row.model_used) throw new Error('model_used required');
  if (row.latency_ms < 0) throw new Error('latency_ms must be non-negative');
  if (row.is_fallback) {
    if (!VALID_FALLBACK_REASONS.has(row.fallback_reason))
      throw new Error(`Invalid fallback_reason: ${row.fallback_reason}`);
    if (row.token_input !== 0 || row.token_output !== 0)
      throw new Error('Ghost fallbacks must have zero token counts');
  }
}

/** Local in-memory retry buffer — survives transient Supabase blips */
const _queue = [];

async function _drainQueue(client) {
  if (!_queue.length) return;
  const batch = _queue.splice(0, _queue.length);
  for (const row of batch) {
    try {
      await client.from('companion_requests').insert(row);
    } catch (_) {
      _queue.unshift(row); // put back at front
      break; // stop draining — still unavailable
    }
  }
}

async function _write(row) {
  const client = getSupabase();
  if (!client) { _queue.push(row); return; }
  try {
    const { error } = await client.from('companion_requests').insert(row);
    if (error) throw error;
    await _drainQueue(client);
  } catch (err) {
    console.error('[companionLogger] Supabase write failed, queuing:', err?.message);
    _queue.push(row);
  }
}

/**
 * record() — write one append-only companion request row.
 *
 * @param {object} opts
 * @param {string}  opts.userId
 * @param {string}  opts.tenantId
 * @param {string}  opts.sessionId
 * @param {string}  opts.companionId       — one of: raylene rylane cloud night oracle
 * @param {string}  opts.modelUsed         — e.g. 'gpt-4o'
 * @param {string}  opts.modelVersion      — pinned version string
 * @param {number}  opts.requestAt         — Date.now() ms at request start
 * @param {number}  opts.responseAt        — Date.now() ms at response received
 * @param {number}  [opts.tokenInput]      — default 0
 * @param {number}  [opts.tokenOutput]     — default 0
 * @param {boolean} [opts.success]         — default true
 * @param {boolean} [opts.isFallback]      — default false
 * @param {string}  [opts.fallbackReason]  — required if isFallback
 * @param {string}  [opts.errorCode]       — provider error code on failure
 * @param {number}  [opts.userVisibleLatencyMs]
 * @returns {Promise<string>} row id
 */
async function record(opts = {}) {
  const id = randomUUID();
  const latencyMs = Math.max(0, (opts.responseAt ?? Date.now()) - (opts.requestAt ?? Date.now()));

  const row = {
    id,
    user_id: opts.userId ?? '',
    tenant_id: opts.tenantId ?? '',
    session_id: opts.sessionId ?? '',
    companion_id: opts.companionId ?? '',
    model_used: opts.modelUsed ?? '',
    model_version: opts.modelVersion ?? '',
    request_at: new Date(opts.requestAt ?? Date.now()).toISOString(),
    response_at: new Date(opts.responseAt ?? Date.now()).toISOString(),
    latency_ms: latencyMs,
    token_input: opts.tokenInput ?? 0,
    token_output: opts.tokenOutput ?? 0,
    success: opts.success ?? true,
    is_fallback: opts.isFallback ?? false,
    fallback_reason: opts.fallbackReason ?? null,
    error_code: opts.errorCode ?? null,
    user_visible_latency_ms: opts.userVisibleLatencyMs ?? null,
  };

  try { validate(row); } catch (e) {
    console.error('[companionLogger] Validation failed:', e.message);
    return id;
  }

  await _write(row); // never throws to caller
  return id;
}

/**
 * withCompanionSpan() — wrap a companion call and auto-log.
 *
 * Usage:
 *   const response = await withCompanionSpan({
 *     userId, tenantId, sessionId,
 *     companionId: 'raylene', modelUsed: 'gpt-4o', modelVersion: '2025-01',
 *   }, async (span) => {
 *     const res = await callModel(prompt);
 *     span.setSuccess({ tokenInput: res.usage.prompt_tokens, tokenOutput: res.usage.completion_tokens });
 *     return res;
 *   });
 */
async function withCompanionSpan(meta, fn) {
  const requestAt = Date.now();
  const span = {
    _success: false, _isFallback: false, _fallbackReason: null,
    _errorCode: null, _tokenInput: 0, _tokenOutput: 0, _userVisibleMs: null,
    setSuccess({ tokenInput = 0, tokenOutput = 0 } = {}) {
      this._success = true;
      this._tokenInput = tokenInput;
      this._tokenOutput = tokenOutput;
    },
    setFallback(reason) {
      this._isFallback = true;
      this._fallbackReason = reason;
      this._success = false;
    },
    setError(code) {
      this._errorCode = code;
      this._success = false;
    },
    setUserVisibleLatency(ms) { this._userVisibleMs = ms; },
  };

  let result;
  try {
    result = await fn(span);
  } catch (err) {
    span.setError(err?.code ?? err?.message ?? 'unknown');
    throw err;
  } finally {
    await record({
      ...meta,
      requestAt,
      responseAt: Date.now(),
      tokenInput: span._tokenInput,
      tokenOutput: span._tokenOutput,
      success: span._success,
      isFallback: span._isFallback,
      fallbackReason: span._fallbackReason,
      errorCode: span._errorCode,
      userVisibleLatencyMs: span._userVisibleMs,
    });
  }
  return result;
}

module.exports = { record, withCompanionSpan, FALLBACK_ENABLED };
