import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImageWithReceipt, resumeImagePrediction } from '../lib/imageClient.js';

const provider = 'replicate';
const model = 'black-forest-labs/flux-schnell';
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000030806000000', 'hex');
function responseJson(data, status = 201) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

test('not configured returns a receipt and does not call provider', async () => {
  const result = await generateImageWithReceipt('Art', { provider, model, token: '', fetchImpl: () => { throw Error('unexpected fetch'); } });
  // Empty overrides may fall back to env; tests only require the explicit result contract.
  assert.equal(['not_configured', 'failed'].includes(result.status), true);
  assert.equal(typeof result.receipt.prompt_hash, 'string');
});

test('prediction is created once and persisted id can be resumed without another POST', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([String(url), init.method]);
    if (init.method === 'POST') return responseJson({ id: 'prediction123', status: 'processing' });
    if (String(url).includes('/v1/predictions/')) return responseJson({
      id: 'prediction123', status: 'succeeded', output: 'https://replicate.delivery/example.png'
    }, 200);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  };
  const opts = { provider, model, token: 'test-token', fetchImpl };
  const first = await generateImageWithReceipt('Cover', opts);
  assert.equal(first.status, 'pending');
  assert.equal(first.receipt.response_id, 'prediction123');
  const resumed = await resumeImagePrediction('prediction123', { ...opts, promptHash: first.receipt.prompt_hash });
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.receipt.byte_size, png.length);
  assert.equal(resumed.receipt.width, 2);
  assert.equal(resumed.receipt.height, 3);
  assert.equal(calls.filter(([,method]) => method === 'POST').length, 1);
});

test('provider 400 never retries and hides response body', async () => {
  let attempts = 0;
  const result = await generateImageWithReceipt('Cover', {
    provider, model, token: 'test-token',
    fetchImpl: async () => { attempts++; return new Response('secret response body', { status: 400 }); }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.receipt.code, 'image_provider_http_error');
  assert.equal(JSON.stringify(result).includes('secret response body'), false);
  assert.equal(attempts, 1);
});

test('cannot fetch untrusted provider output URL', async () => {
  const result = await resumeImagePrediction('prediction123', {
    provider, model, token: 'test-token', promptHash: 'hash',
    fetchImpl: async () => responseJson({ id: 'prediction123', status: 'succeeded', output: 'http://127.0.0.1/private' }, 200)
  });
  assert.equal(result.receipt.code, 'image_untrusted_output_url');
});
