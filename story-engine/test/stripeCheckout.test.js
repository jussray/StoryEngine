import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutIdempotencyKey,
  buildCheckoutSessionForm,
  createStripeCheckoutSession,
  parseStripePriceMap,
  resolveStripePrice,
  StripeCheckoutError
} from '../lib/stripeCheckout.js';

test('price map is server-owned and resolves a configured plan', () => {
  const raw = JSON.stringify({ pro: 'price_test_pro', studio: 'price_test_studio' });
  assert.deepStrictEqual(parseStripePriceMap(raw), {
    pro: 'price_test_pro',
    studio: 'price_test_studio'
  });
  assert.deepStrictEqual(resolveStripePrice('PRO', raw), {
    plan: 'pro',
    priceId: 'price_test_pro'
  });
});

test('unconfigured plans fail instead of accepting a client price', () => {
  assert.throws(
    () => resolveStripePrice('enterprise', JSON.stringify({ pro: 'price_test_pro' })),
    error => error instanceof StripeCheckoutError && error.code === 'STRIPE_PLAN_UNAVAILABLE'
  );
});

test('checkout form carries only server-selected price authority', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const body = buildCheckoutSessionForm({
      workspaceId: 'ws_1',
      tenantId: 'tenant_1',
      plan: 'pro',
      priceId: 'price_test_pro',
      publicUrl: 'http://127.0.0.1:3000'
    });
    const form = new URLSearchParams(body);
    assert.strictEqual(form.get('mode'), 'subscription');
    assert.strictEqual(form.get('line_items[0][price]'), 'price_test_pro');
    assert.strictEqual(form.get('metadata[workspace_id]'), 'ws_1');
    assert.strictEqual(form.get('subscription_data[metadata][plan]'), 'pro');
    assert.strictEqual(form.has('line_items[0][price_data][unit_amount]'), false);
    assert.strictEqual([...form.keys()].some(key => key.includes('payment_method_types')), false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('idempotency key is stable for the same checkout attempt', () => {
  const input = {
    tenantId: 'tenant',
    actorId: 'actor',
    workspaceId: 'ws',
    plan: 'pro',
    attemptId: 'attempt-1'
  };
  const first = buildCheckoutIdempotencyKey(input);
  const second = buildCheckoutIdempotencyKey(input);
  const changed = buildCheckoutIdempotencyKey({ ...input, attemptId: 'attempt-2' });
  assert.strictEqual(first, second);
  assert.notStrictEqual(first, changed);
  assert.match(first, /^l99_checkout_[0-9a-f]{64}$/);
});

test('Stripe transport sends form body and idempotency without leaking secret', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBase = process.env.STRIPE_API_BASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.STRIPE_API_BASE_URL = 'http://127.0.0.1:9999/v1';

  let request = null;
  try {
    const result = await createStripeCheckoutSession({
      apiKey: 'sk_test_private',
      formBody: 'mode=subscription',
      idempotencyKey: 'idem_test',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/test' };
          }
        };
      }
    });
    assert.deepStrictEqual(result, {
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/test'
    });
    assert.strictEqual(request.url, 'http://127.0.0.1:9999/v1/checkout/sessions');
    assert.strictEqual(request.options.headers['Idempotency-Key'], 'idem_test');
    assert.strictEqual(request.options.headers.Authorization, 'Bearer sk_test_private');
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousBase === undefined) delete process.env.STRIPE_API_BASE_URL;
    else process.env.STRIPE_API_BASE_URL = previousBase;
  }
});
