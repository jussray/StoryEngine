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
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
  anthropic_fast: process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-3-5',
  anthropic_deep: process.env.ANTHROPIC_DEEP_MODEL || 'claude-opus-4',
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openrouter: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
});

const providerState = new Map();
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60_000);
const DEFAULT_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES || 2);
const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.LLM_CIRCUIT_FAILURE_THRESHOLD || 5);
const CIRCUIT_RESET_MS = Number(process.env.LLM_CIRCUIT_RESET_MS || 60_000);
const MAX_TOKENS_CAP = Number(process.env.LLM_MAX_TOKENS_CAP || 8192);

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

function boundedMaxTokens(options = {}) {
  const requested = Number(options.maxTokens || 4096);
  if (!Number.isFinite(requested) || requested < 1) return 4096;
  return Math.min(Math.floor(requested), MAX_TOKENS_CAP);
}

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

function stateFor(provider) {
  if (!providerState.has(provider)) providerState.set(provider, { failures: 0, opened_at: null, last_error: null, calls: 0, successes: 0 });
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
  state.last_error = String(error?.message || error).slice(0, 300);
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) state.opened_at = Date.now();
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithPolicy(provider, url, init, options = {}) {
  assertCircuitClosed(provider);
  const retries = Math.max(0, Number(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms.`)), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new Error(`LLM provider request failed with status ${response.status}: ${body.slice(0, 160)}`);
        error.status = response.status;
        if (!retryableStatus(response.status) || attempt === retries) throw error;
        lastError = error;
      } else {
        noteSuccess(provider);
        return response;
      }
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || retryableStatus(Number(error?.status || 0)) || !error?.status;
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

async function completeOpenAI(prompt, options = {}) {
  const useOpenRouter = options.provider === 'openrouter' || process.env.LLM_BASE_URL || process.env.OPENROUTER_API_KEY;
  const provider = useOpenRouter ? 'openrouter' : 'openai';
  const apiKey = useOpenRouter ? process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(useOpenRouter ? 'OPENROUTER_API_KEY or OPENAI_API_KEY is required.' : 'OPENAI_API_KEY is required.');

  const baseUrl = process.env.LLM_BASE_URL || (useOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1');
  const response = await fetchWithPolicy(provider, `${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${apiKey}` }),
    body: JSON.stringify({
      model: pickModel(provider, options),
      max_tokens: boundedMaxTokens(options),
      temperature: options.temperature ?? 0.2,
      response_format: options.json ? { type: 'json_object' } : undefined,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt }
      ].filter(Boolean)
    })
  }, options);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function completeAnthropic(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required.');

  const response = await fetchWithPolicy('anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: headers({ 'x-api-key': apiKey, 'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01' }),
    body: JSON.stringify({
      model: pickModel('anthropic', options),
      max_tokens: boundedMaxTokens(options),
      temperature: options.temperature ?? 0.2,
      system: options.system || undefined,
      messages: [{ role: 'user', content: prompt }]
    })
  }, options);
  const data = await response.json();
  return (data.content || []).map(part => part.text || '').join('\n').trim();
}

export async function complete(prompt, options = {}) {
  const provider = pickProvider(options);
  if (provider === 'anthropic') return completeAnthropic(prompt, { ...options, provider });
  if (provider === 'openrouter') return completeOpenAI(prompt, { ...options, provider });
  if (provider === 'openai') return completeOpenAI(prompt, { ...options, provider });
  throw new Error(`Unsupported LLM provider: ${provider}.`);
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
    circuits: Object.fromEntries([...providerState.entries()].map(([provider, state]) => [provider, { ...state, open: Boolean(state.opened_at) }]))
  };
}
