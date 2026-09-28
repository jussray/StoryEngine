import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const originalKey = process.env.MODEL_API_KEY;
const originalModel = process.env.MUSE_MODEL;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.MODEL_API_KEY;
  else process.env.MODEL_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.MUSE_MODEL;
  else process.env.MUSE_MODEL = originalModel;
});

test('Muse uses server key, non-stored request, and returns provider evidence', async () => {
  process.env.MODEL_API_KEY = 'muse-test-key';
  process.env.MUSE_MODEL = 'muse-spark-1.3';
  let observed;
  global.fetch = async (url, init) => {
    observed = {url: String(url), init};
    return new Response(JSON.stringify({
      id: 'resp_story_muse_1',
      status: 'completed',
      model: 'muse-spark-1.3',
      output_text: 'Muse result',
    }), {status: 200, headers: {'content-type': 'application/json'}});
  };

  const {completeMuseWithReceipt} = await import(`../lib/museClient.js?test=${Date.now()}`);
  const receipt = await completeMuseWithReceipt('Challenge this story architecture.', {maxTokens: 64});
  assert.equal(observed.url, 'https://api.meta.ai/v1/responses');
  assert.equal(observed.init.headers.Authorization, 'Bearer muse-test-key');
  assert.doesNotMatch(String(observed.init.body), /muse-test-key/);
  const body = JSON.parse(observed.init.body);
  assert.equal(body.store, false);
  assert.equal(body.model, 'muse-spark-1.3');
  assert.equal(receipt.provenance.provider, 'muse');
  assert.equal(receipt.provenance.evidence_ref, 'provider:meta:resp_story_muse_1');
});

test('Muse refuses restricted context before network use', async () => {
  process.env.MODEL_API_KEY = 'muse-test-key';
  global.fetch = async () => { throw new Error('network should not run'); };
  const {completeMuseWithReceipt} = await import(`../lib/museClient.js?restricted=${Date.now()}`);
  await assert.rejects(
    () => completeMuseWithReceipt('private', {sensitivity: 'restricted'}),
    /not authorized/,
  );
});
