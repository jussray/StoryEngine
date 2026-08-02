/**
 * companionLogger.js — Batch 2, Companion Pipeline Observability (Node)
 *
 * Append-only logger for every companion AI request in the story-engine.
 * No message body is ever stored. Retries are new rows.
 * Service-role-only Supabase insert — never called from client code.
 * Fails closed: companion calls complete even if logging is unavailable.
 *
 * Governed by: GLOBAL_AI.md, schemas/companion_requests.schema.json
 */

import { randomUUID } from 'node:crypto';

const VALID_COMPANIONS = new Set(['raylene', 'rylane', 'cloud', 'night', 'oracle']);
const VALID_FALLBACK_REASONS = new Set([
  'api_error_500', 'api_timeout', 'api_rate_limit',
  'network_offline', 'safety_block', 'budget_exceeded',
]);

export const FALLBACK_ENABLED =
  (process.env.COMPANION_GHOST_FALLBACK_ENABLED ?? 'true') === 'true';

let supabaseClient = null;
let supabaseLoadAttempted = false;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (supabaseLoadAttempted) return null;

  supabaseLoadAttempted = true;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false },
    });
    return supabaseClient;
  } catch (error) {
    console.error('[companionLogger] Supabase client unavailable:', error?.message);
    return null;
  }
}

function validate(row) {
  if (!row.user_id) throw new Error('user_id required');
  if (!row.tenant_id) throw new Error('tenant_id required');
  if (!row.session_id) throw new Error('session_id required');
  if (!VALID_COMPANIONS.has(row.companion_id)) {
    throw new Error(`Unknown companion_id: ${row.companion_id}`);
  }
  if (!row.model_used) throw new Error('model_used required');
  if (row.latency_ms < 0) throw new Error('latency_ms must be non-negative');
  if (row.is_fallback) {
    if (!VALID_FALLBACK_REASONS.has(row.fallback_reason)) {
      throw new Error(`Invalid fallback_reason: ${row.fallback_reason}`);
    }
    if (row.token_input !== 0 || row.token_output !== 0) {
      throw new Error('Ghost fallbacks must have zero token counts');
    }
  }
}

const queue = [];

async function drainQueue(client) {
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  for (const row of batch) {
    try {
      const { error } = await client.from('companion_requests').insert(row);
      if (error) throw error;
    } catch (_) {
      queue.unshift(row);
      break;
    }
  }
}

async function write(row) {
  const client = await getSupabase();
  if (!client) {
    queue.push(row);
    return;
  }

  try {
    const { error } = await client.from('companion_requests').insert(row);
    if (error) throw error;
    await drainQueue(client);
  } catch (error) {
    console.error('[companionLogger] Supabase write failed, queuing:', error?.message);
    queue.push(row);
  }
}

export async function record(opts = {}) {
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

  try {
    validate(row);
  } catch (error) {
    console.error('[companionLogger] Validation failed:', error.message);
    return id;
  }

  await write(row);
  return id;
}

export async function withCompanionSpan(meta, fn) {
  const requestAt = Date.now();
  const span = {
    _success: false,
    _isFallback: false,
    _fallbackReason: null,
    _errorCode: null,
    _tokenInput: 0,
    _tokenOutput: 0,
    _userVisibleMs: null,
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
    setUserVisibleLatency(ms) {
      this._userVisibleMs = ms;
    },
  };

  let result;
  try {
    result = await fn(span);
  } catch (error) {
    span.setError(error?.code ?? error?.message ?? 'unknown');
    throw error;
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
