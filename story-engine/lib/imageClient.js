// One server-side image provider boundary. No provider keys are sent to clients.
import { createHash } from 'node:crypto';

const state = new Map();
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const RETRYABLE = new Set([408, 409, 425, 429]);
const RESULT_STATUS = new Set(['succeeded', 'failed', 'canceled']);

function bounded(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}
const timeoutMs = () => bounded(process.env.IMAGE_TIMEOUT_MS, 120000, 1000, 600000);
const retryLimit = () => bounded(process.env.IMAGE_MAX_RETRIES, 2, 0, 4);
const failureThreshold = () => bounded(process.env.IMAGE_CIRCUIT_FAILURE_THRESHOLD, 5, 1, 100);
const resetMs = () => bounded(process.env.IMAGE_CIRCUIT_RESET_MS, 60000, 1000, 3600000);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function config(options) {
  const provider = String(options.provider || process.env.IMAGE_PROVIDER || '').toLowerCase();
  const model = String(options.model || process.env.REPLICATE_IMAGE_MODEL || process.env.IMAGE_MODEL || '');
  const token = options.token || process.env.REPLICATE_API_TOKEN || '';
  return { provider, model, token };
}

function safeReceipt({ provider, model, promptHash, status, code, predictionId = null, byteSize = 0, contentHash = null, width = null, height = null, cost = null }) {
  return Object.freeze({
    provider: provider || null, requested_model: model || null,
    response_model: model || null, response_id: predictionId,
    prompt_hash: promptHash, status, code, byte_size: byteSize,
    content_hash: contentHash, width, height, cost_usd: cost
  });
}

function failure(provider, model, promptHash, code, predictionId = null) {
  return { status: 'failed', receipt: safeReceipt({ provider, model, promptHash, status: 'failed', code, predictionId }) };
}

function providerState(provider) {
  if (!state.has(provider)) state.set(provider, { failures: 0, openedAt: 0 });
  const value = state.get(provider);
  if (value.openedAt && Date.now() - value.openedAt >= resetMs()) {
    value.openedAt = 0;
    value.failures = 0;
  }
  return value;
}

function addFailure(provider) {
  const item = providerState(provider);
  item.failures += 1;
  if (item.failures >= failureThreshold()) item.openedAt = Date.now();
}

async function httpRequest(url, init, fetchImpl, retries = 0) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const error = new Error('image_provider_http_error');
        error.code = 'image_provider_http_error';
        error.status = response.status;
        if (attempt < retries && (RETRYABLE.has(response.status) || response.status >= 500)) {
          await new Promise(resolve => setTimeout(resolve, Math.min(2000, 100 * (2 ** attempt))));
          continue;
        }
        throw error;
      }
      return response;
    } catch (error) {
      if (attempt < retries && (error.name === 'AbortError' || error.code === 'image_timeout')) {
        await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
        continue;
      }
      if (error.name === 'AbortError') {
        const timeout = new Error('image_timeout');
        timeout.code = 'image_timeout';
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function imageFormat(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', width: null, height: null };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', width: null, height: null };
  }
  return null;
}

async function collectImage(prediction, context) {
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (typeof output !== 'string') return failure(context.provider, context.model, context.promptHash, 'image_missing_output', prediction.id);
  let url;
  try { url = new URL(output); } catch { return failure(context.provider, context.model, context.promptHash, 'image_invalid_output_url', prediction.id); }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*replicate\.delivery$/i.test(url.hostname)) {
    return failure(context.provider, context.model, context.promptHash, 'image_untrusted_output_url', prediction.id);
  }
  const response = await httpRequest(url.toString(), { method: 'GET', redirect: 'error' }, context.fetchImpl, retryLimit());
  if (Number(response.headers.get('content-length') || 0) > MAX_OUTPUT_BYTES) return failure(context.provider, context.model, context.promptHash, 'image_output_too_large', prediction.id);
  // Bound the stream while reading, not only after an attacker-controlled Content-Length.
  const reader = response.body?.getReader();
  if (!reader) return failure(context.provider, context.model, context.promptHash, 'image_empty_output', prediction.id);
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_OUTPUT_BYTES) {
        await reader.cancel().catch(() => {});
        return failure(context.provider, context.model, context.promptHash, 'image_output_too_large', prediction.id);
      }
      parts.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(parts);
  const format = imageFormat(bytes);
  if (!format) return failure(context.provider, context.model, context.promptHash, 'image_invalid_output_format', prediction.id);
  const receipt = safeReceipt({
    provider: context.provider, model: context.model, promptHash: context.promptHash,
    status: 'complete', code: null, predictionId: prediction.id,
    byteSize: bytes.length, contentHash: sha256(bytes), width: format.width, height: format.height
  });
  return { status: 'complete', image: { bytes, content_type: format.mime }, receipt };
}

async function resolvePrediction(prediction, context) {
  if (prediction.status === 'succeeded') return collectImage(prediction, context);
  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    return failure(context.provider, context.model, context.promptHash, 'image_prediction_failed', prediction.id);
  }
  return {
    status: 'pending',
    receipt: safeReceipt({
      provider: context.provider, model: context.model, promptHash: context.promptHash,
      status: 'pending', code: 'image_prediction_pending', predictionId: prediction.id
    })
  };
}

export async function generateImageWithReceipt(prompt, options = {}) {
  const { provider, model, token } = config(options);
  const promptHash = sha256(String(prompt || ''));
  if (!provider || !model || !token || provider !== 'replicate') {
    return { status: 'not_configured', receipt: safeReceipt({
      provider, model, promptHash, status: 'not_configured', code: 'image_provider_not_configured'
    }) };
  }
  if (!/^[-a-z0-9]+\/[-a-z0-9.]+$/i.test(model) || !String(prompt || '').trim()) {
    return failure(provider, model, promptHash, 'image_invalid_request');
  }
  const stateNow = providerState(provider);
  if (stateNow.openedAt) return failure(provider, model, promptHash, 'image_circuit_open');
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await httpRequest(
      'https://api.replicate.com/v1/models/' + model + '/predictions',
      { method: 'POST', headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'wait=1'
      }, body: JSON.stringify({ input: { prompt: String(prompt), aspect_ratio: '2:3' } }) },
      fetchImpl,
      0 // Creation POST is deliberately not retried: unknown outcomes can bill twice.
    );
    const prediction = await response.json();
    if (!prediction || typeof prediction.id !== 'string' || !/^[a-z0-9]+$/i.test(prediction.id)) {
      throw Object.assign(new Error('image_invalid_provider_response'), { code: 'image_invalid_provider_response' });
    }
    const result = await resolvePrediction(prediction, { provider, model, promptHash, fetchImpl });
    stateNow.failures = 0;
    return result;
  } catch (error) {
    addFailure(provider);
    return failure(provider, model, promptHash,
      error.code === 'image_timeout' ? 'image_timeout'
        : error.code === 'image_provider_http_error' ? 'image_provider_http_error'
        : 'image_provider_unavailable');
  }
}

export async function resumeImagePrediction(predictionId, options = {}) {
  const { provider, model, token } = config(options);
  const promptHash = String(options.promptHash || '');
  if (provider !== 'replicate' || !token || !model) return {
    status: 'not_configured',
    receipt: safeReceipt({ provider, model, promptHash, status: 'not_configured', code: 'image_provider_not_configured' })
  };
  if (!/^[a-z0-9]+$/i.test(String(predictionId || ''))) return failure(provider, model, promptHash, 'image_invalid_prediction_id');
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await httpRequest(
      'https://api.replicate.com/v1/predictions/' + predictionId,
      { method: 'GET', headers: { Authorization: 'Bearer ' + token } },
      fetchImpl, retryLimit()
    );
    const prediction = await response.json();
    if (prediction.id !== predictionId || !RESULT_STATUS.has(prediction.status) && !['starting','processing'].includes(prediction.status)) {
      return failure(provider, model, promptHash, 'image_invalid_provider_response', predictionId);
    }
    return await resolvePrediction(prediction, { provider, model, promptHash, fetchImpl });
  } catch (error) {
    return failure(provider, model, promptHash,
      error.code === 'image_timeout' ? 'image_timeout' : 'image_provider_unavailable', predictionId);
  }
}

export async function generateImage(prompt, options = {}) {
  const result = await generateImageWithReceipt(prompt, options);
  return result.status === 'complete' ? result.image : null;
}
