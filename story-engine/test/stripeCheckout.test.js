import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER,
  buildCheckoutIdempotencyKey,
  buildSubscriptionCheckoutParams,
  parseStripePriceMap,
  resolveStripePrice
} from '../lib/stripeCheckout.js';

test('price map is server-authoritative and validates Stripe price IDs', () => {
  assert.deepStrictEqual(
    parseStripePriceMap('{"pro":"price_123ABC"}'),
    { pro: 'price_123ABC' }
  );
  assert.throws(() => parseStripePriceMap('{"pro":"29.99"}'), /Invalid Stripe plan mapping/);
  assert.deepStrictEqual(resolveStripePrice('PRO', '{"pro":"price_123ABC"}'), {
    plan: 'pro',
    priceId: 'price_123ABC'
  });
});

test('checkout params use hosted subscription Checkout without hard-coded payment methods', () => {
  const params = buildSubscriptionCheckoutParams({
    workspaceId: 'ws_123',
    plan: 'pro',
    priceId: 'price_123ABC',
    publicUrl: 'https://l99.example'
  });

  assert.strictEqual(params.mode, 'subscription');
  assert.deepStrictEqual(params.line_items, [{ price: 'price_123ABC', quantity: 1 }]);
  assert.strictEqual(params.client_reference_id, 'ws_123');
  assert.deepStrictEqual(params.metadata, { workspace_id: 'ws_123', plan: 'pro' });
  assert.deepStrictEqual(params.subscription_data.metadata, { workspace_id: 'ws_123', plan: 'pro' });
  assert.strictEqual(params.integration_identifier, STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER);
  assert.ok(!('payment_method_types' in params));
});

test('checkout origin rejects insecure non-local production URLs', () => {
  assert.throws(() => buildSubscriptionCheckoutParams({
    workspaceId: 'ws_123',
    plan: 'pro',
    priceId: 'price_123ABC',
    publicUrl: 'http://example.com'
  }), /HTTPS/);
});

test('idempotency key is deterministic for the same governed checkout attempt', () => {
  const input = {
    tenantId: 'tenant_1',
    actorId: 'actor_1',
    workspaceId: 'ws_123',
    plan: 'pro',
    attemptId: 'attempt-0001'
  };
  const first = buildCheckoutIdempotencyKey(input);
  const second = buildCheckoutIdempotencyKey(input);
  assert.strictEqual(first, second);
  assert.match(first, /^l99-checkout-[0-9a-f]{48}$/);
});
