// lib/llmClient.js
// Single LLM boundary for L99. Engine modules should call complete() or completeJson().

const DEFAULT_TASK_PROVIDERS = Object.freeze({
  chapter_generation: 'anthropic',
  conflict_explanation: 'anthropic',
  series_bible: 'anthropic',
  tone_analysis: 'anthropic',
  entity_extraction: 'openai',
  ooda_decision: 'openai',
  json: 'openai',
  default: 'anthropic'
});

const DEFAULT_MODELS = Object.freeze({
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  anthropic_fast: process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001',
  anthropic_deep: process.env.ANTHROPIC_DEEP_MODEL || 'claude-opus-5',
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openrouter: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
});

const LLM_CLIENT_STARTED_AT = Date.now();
const providerState = new Map();

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

const DEFAULT_TIMEOUT_MS = boundedInteger(process.env.LLM_TIMEOUT_MS, 60_000, 1_000, 300_000);
const DEFAULT_MAX_RETRIES = boundedInteger(process.env.LLM_MAX_RETRIES, 2, 0, 10);
const CIRCUIT_FAILURE_THRESHOLD = boundedInteger(process.env.LLM_CIRCUIT_FAILURE_THRESHOLD, 5, 1, 100);
const CIRCUIT_RESET_MS = boundedInteger(process.env.LLM_CIRCUIT_RESET_MS, 60_000, 1_000, 3_600_000);
const MAX_TOKENS_CAP = boundedInteger(process.env.LLM_MAX_TOKENS_CAP, 8192, 1, 128_000);
const ERROR_BODY_MAX_BYTES = boundedInteger(process.env.LLM_ERROR_BODY_MAX_BYTES, 4096, 256, 65_536);

function pickProvider(options = {}) {
  if (options.provider) return options.provider;
  if (options.task && DEFAULT_TASK_PROVIDERS[options.task]) return DEFAULT_TASK_PROVIDERS[options.task];
  return process.env.DEFAULT_LLM || DEFAULT_TASK_PROVIDERS.default;
}

function pickModel(provider, options = {}) {
  if (options.model) return options.model;
  if (options.task === 'tone_analysis') return DEFAULT_MODELS.anthropic_fast;
  if (options.task === 'series_bible') return DEFAULT_MODELS.anthropic_deep;
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
}

function boundedMaxTokens(options = {}, model = '') {
  const requested = Number(options.maxTokens || 4096);
  const normalized = !Number.isFinite(requested) || requested < 1 ? 4096 : Math.floor(requested);
  const modelCap = String(model).startsWith('claude-haiku-4-5') ? 64_000 : MAX_TOKENS_CAP;
  return Math.min(normalized, modelCap, MAX_TOKENS_CAP);
}

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

function stateFor(provider) {
  if (!providerState.has(provider)) {
    providerState.set(provider, {
      failures: 0,
      opened_at: null,
      last_error: null,
      calls: 0,
      successes: 0,
      created_at: Date.now()
    });
  }
  return providerState.get(provider);
}

function assertCircuitClosed(provider) {
  const state = stateFor(provider);
  if (!state.opened_at) return;
  if (Date.now() - state.opened_at >= CIRCUIT_RESET_MS) {
    state.opened_at = null;
    state.failures = 0;
    return;
  }
  const error = new Error(`LLM provider circuit is open for ${provider}.`);
  error.code = 'llm_circuit_open';
  throw error;
}

function safeFailureSummary(provider, error) {
  const status = Number(error?.status || 0);
  if (status) return `${provider} HTTP ${status}`;
  if (error?.code === 'llm_timeout' || error?.name === 'AbortError') return `${provider} timeout`;
  if (error?.code === 'llm_circuit_open') return `${provider} circuit_open`;
  return `${provider} request_failed`;
}

function noteSuccess(provider) {
  const state = stateFor(provider);
  state.calls += 1;
  state.successes += 1;
  state.failures = 0;
  state.opened_at = null;
  state.last_error = null;
}

function noteFailure(provider, error) {
  const state = stateFor(provider);
  state.calls += 1;
  state.failures += 1;
  state.last_error = safeFailureSummary(provider, error);
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) state.opened_at = Date.now();
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readBoundedResponseText(response, maxBytes = ERROR_BODY_MAX_BYTES) {
  const body = response?.body;
  if (!body || typeof body.getReader !== 'function') return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
      const remaining = maxBytes - bytesRead;
      const take = Math.min(remaining, value.byteLength);
      text += decoder.decode(value.subarray(0, take), { stream: true });
      bytesRead += take;
      if (take < value.byteLength || bytesRead >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    text += decoder.decode();
    return text;
  } catch {
    return '';
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function safeProviderErrorType(rawBody) {
  if (!rawBody) return null;
  try {
    const parsed = JSON.parse(rawBody);
    const type = String(parsed?.error?.type || parsed?.type || '').trim();
    return /^[a-z0-9_.-]{1,80}$/i.test(type) ? type : null;
  } catch {
    return null;
  }
}

async function fetchWithPolicy(provider, url, init, options = {}) {
  assertCircuitClosed(provider);
  const retries = boundedInteger(options.maxRetries, DEFAULT_MAX_RETRIES, 0, 10);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 300_000);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const timeout = new Error(`LLM request timed out after ${timeoutMs}ms.`);
      timeout.code = 'llm_timeout';
      controller.abort(timeout);
    }, timeoutMs);

    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        const rawBody = await readBoundedResponseText(response);
        const errorType = safeProviderErrorType(rawBody);
        const error = new Error(`LLM provider request failed with status ${response.status}${errorType ? ` (${errorType})` : ''}.`);
        error.status = response.status;
        error.code = 'llm_provider_http_error';
        if (!retryableStatus(response.status) || attempt === retries) throw error;
        lastError = error;
      } else {
        noteSuccess(provider);
        return response;
      }
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || error?.code === 'llm_timeout' || retryableStatus(Number(error?.status || 0)) || !error?.status;
      if (!retryable || attempt === retries) {
        noteFailure(provider, error);
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }

    const backoff = Math.min(5000, 250 * 2 ** attempt) + Math.floor(Math.random() * 150);
    await delay(backoff);
  }

  noteFailure(provider, lastError);
  throw lastError || new Error(`LLM provider request failed for ${provider}.`);
}

async function completeOpenAIWithReceipt(prompt, options = {}) {
  const useOpenRouter = options.provider === 'openrouter' || process.env.LLM_BASE_URL || process.env.OPENROUTER_API_KEY;
  const provider = useOpenRouter ? 'openrouter' : 'openai';
  const apiKey = useOpenRouter ? process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(useOpenRouter ? 'OPENROUTER_API_KEY or OPENAI_API_KEY is required.' : 'OPENAI_API_KEY is required.');

  const baseUrl = process.env.LLM_BASE_URL || (useOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1');
  const model = pickModel(provider, options);
  const response = await fetchWithPolicy(provider, `${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${apiKey}` }),
    body: JSON.stringify({
      model,
      max_tokens: boundedMaxTokens(options, model),
      temperature: options.temperature ?? 0.2,
      response_format: options.json ? { type: 'json_object' } : undefined,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt }
      ].filter(Boolean)
    })
  }, options);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('OpenAI-compatible response was not valid JSON.');
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('OpenAI-compatible response is missing assistant text.');

  return Object.freeze({
    text,
    provenance: Object.freeze({
      provider,
      requested_model: model,
      response_model: typeof data.model === 'string' ? data.model : null,
      response_id: typeof data.id === 'string' ? data.id : null
    })
  });
}

async function completeAnthropicWithReceipt(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required.');
  const workspaceId = String(process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  const model = pickModel('anthropic', options);
  const apiVersion = process.env.ANTHROPIC_VERSION || '2023-06-01';

  const body = {
    model,
    max_tokens: boundedMaxTokens(options, model),
    system: options.system || undefined,
    messages: [{ role: 'user', content: prompt }]
  };
  if (options.temperature !== undefined && !String(model).startsWith('claude-sonnet-5')) {
    body.temperature = options.temperature;
  }

  const response = await fetchWithPolicy('anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: headers({
      'x-api-key': apiKey,
      'anthropic-version': apiVersion,
      ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {})
    }),
    body: JSON.stringify(body)
  }, options);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Anthropic response was not valid JSON.');
  }
  if (data?.type !== 'message' || data?.role !== 'assistant' || !Array.isArray(data.content)) {
    throw new Error('Anthropic response is not a valid Messages API assistant envelope.');
  }
  const text = data.content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Anthropic response contained no text output.');

  return Object.freeze({
    text,
    provenance: Object.freeze({
      provider: 'anthropic',
      requested_model: model,
      response_model: typeof data.model === 'string' ? data.model : null,
      response_id: typeof data.id === 'string' ? data.id : null,
      api_version: apiVersion,
      workspace_header_configured: Boolean(workspaceId)
    })
  });
}

export async function completeWithReceipt(prompt, options = {}) {
  const provider = pickProvider(options);
  if (provider === 'anthropic') return completeAnthropicWithReceipt(prompt, { ...options, provider });
  if (provider === 'openrouter') return completeOpenAIWithReceipt(prompt, { ...options, provider });
  if (provider === 'openai') return completeOpenAIWithReceipt(prompt, { ...options, provider });
  throw new Error(`Unsupported LLM provider: ${provider}.`);
}

export async function complete(prompt, options = {}) {
  const receipt = await completeWithReceipt(prompt, options);
  return receipt.text;
}

export async function completeJson(prompt, options = {}) {
  const raw = await complete(prompt, { ...options, json: true, task: options.task || 'json' });
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('LLM did not return valid JSON.');
  }
}

export function llmRoutingSnapshot() {
  return {
    default_provider: process.env.DEFAULT_LLM || DEFAULT_TASK_PROVIDERS.default,
    task_providers: DEFAULT_TASK_PROVIDERS,
    models: DEFAULT_MODELS,
    openrouter_enabled: Boolean(process.env.OPENROUTER_API_KEY || process.env.LLM_BASE_URL),
    timeout_ms: DEFAULT_TIMEOUT_MS,
    max_retries: DEFAULT_MAX_RETRIES,
    max_tokens_cap: MAX_TOKENS_CAP,
    error_body_max_bytes: ERROR_BODY_MAX_BYTES,
    circuit_failure_threshold: CIRCUIT_FAILURE_THRESHOLD,
    circuit_reset_ms: CIRCUIT_RESET_MS,
    client_started_at: LLM_CLIENT_STARTED_AT,
    circuit_state_scope: 'process_memory_resets_on_restart',
    circuits: Object.fromEntries([...providerState.entries()].map(([provider, state]) => [provider, { ...state, open: Boolean(state.opened_at) }]))
  };
}
