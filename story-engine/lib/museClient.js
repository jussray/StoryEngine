const MUSE_URL = 'https://api.meta.ai/v1/responses';
const DEFAULT_MODEL = process.env.MUSE_MODEL || 'muse-spark-1.3';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function validResponseId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function extractText(body) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(body?.output) ? body.output : []) {
    if (item?.type !== 'message') continue;
    for (const block of Array.isArray(item?.content) ? item.content : []) {
      if (block?.type === 'output_text' && typeof block.text === 'string' && block.text.trim()) {
        parts.push(block.text.trim());
      }
    }
  }
  return parts.join('\n');
}

async function readBoundedJson(response, maxBytes) {
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    const error = new Error('Muse response exceeded the configured success-body limit.');
    error.code = 'llm_provider_response_too_large';
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Muse response was not valid JSON.');
    error.code = 'llm_provider_invalid_json';
    throw error;
  }
}

export async function completeMuseWithReceipt(prompt, options = {}) {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error('MODEL_API_KEY is required.');
  if (String(options.sensitivity || 'standard').trim().toLowerCase() === 'restricted') {
    throw new Error('Restricted context is not authorized for Muse.');
  }

  const model = String(options.model || DEFAULT_MODEL).trim();
  if (!/^muse-spark-1\.(?:1|2|3)$/.test(model)) throw new Error('Unsupported Muse model.');
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 300_000);
  const maxBytes = boundedInteger(options.successBodyMaxBytes, MAX_RESPONSE_BYTES, 1024, 16_777_216);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(MUSE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [options.system, prompt].filter(Boolean).join('\n\n'),
        store: false,
        max_output_tokens: boundedInteger(options.maxTokens, 4096, 1, 8192)
      }),
      redirect: 'error',
      signal: controller.signal
    });
  } catch {
    const error = new Error('LLM provider request failed for muse.');
    error.code = controller.signal.aborted ? 'llm_timeout' : 'llm_provider_request_failed';
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    try { await response.body?.cancel(); } catch {}
    const error = new Error(`LLM provider request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = 'llm_provider_http_error';
    throw error;
  }

  const data = await readBoundedJson(response, maxBytes);
  if (data?.status !== 'completed') throw new Error('Muse response did not complete.');
  const id = validResponseId(data?.id);
  if (!id) throw new Error('Muse response identity was invalid.');
  const text = extractText(data);
  if (!text) throw new Error('Muse response contained no text output.');

  return Object.freeze({
    text,
    provenance: Object.freeze({
      provider: 'muse',
      requested_model: model,
      response_model: typeof data.model === 'string' ? data.model : model,
      response_id: id,
      evidence_ref: `provider:meta:${id}`
    })
  });
}
