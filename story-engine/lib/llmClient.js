// lib/llmClient.js
// Single LLM boundary for L99. Engine modules should call complete() or completeJson()
// instead of importing provider SDKs directly.

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

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

async function completeOpenAI(prompt, options = {}) {
  const useOpenRouter = options.provider === 'openrouter' || process.env.LLM_BASE_URL || process.env.OPENROUTER_API_KEY;
  const apiKey = useOpenRouter
    ? process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
    : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(useOpenRouter ? 'OPENROUTER_API_KEY or OPENAI_API_KEY is required.' : 'OPENAI_API_KEY is required.');

  const baseUrl = process.env.LLM_BASE_URL || (useOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${apiKey}` }),
    body: JSON.stringify({
      model: pickModel(options.provider === 'openrouter' ? 'openrouter' : 'openai', options),
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
      response_format: options.json ? { type: 'json_object' } : undefined,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt }
      ].filter(Boolean)
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI-compatible completion failed: ${response.status} ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function completeAnthropic(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: headers({
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01'
    }),
    body: JSON.stringify({
      model: pickModel('anthropic', options),
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
      system: options.system || undefined,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic completion failed: ${response.status} ${body.slice(0, 300)}`);
  }
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
    openrouter_enabled: Boolean(process.env.OPENROUTER_API_KEY || process.env.LLM_BASE_URL)
  };
}
