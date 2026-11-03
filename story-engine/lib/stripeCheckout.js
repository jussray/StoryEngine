import { createHash } from 'node:crypto';

const OFFICIAL_STRIPE_API_BASE = 'https://api.stripe.com/v1';
const PLAN_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/;

export class StripeCheckoutError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'StripeCheckoutError';
    this.code = code;
    this.status = status;
  }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function parseStripePriceMap(raw = process.env.STRIPE_PRICE_MAP_JSON) {
  const source = String(raw || '').trim();
  if (!source) {
    throw new StripeCheckoutError('STRIPE_PRICE_MAP_UNCONFIGURED', 'Stripe price map is not configured.');
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new StripeCheckoutError('STRIPE_PRICE_MAP_INVALID', 'Stripe price map must be valid JSON.');
  }

  const input = record(parsed);
  if (!input) {
    throw new StripeCheckoutError('STRIPE_PRICE_MAP_INVALID', 'Stripe price map must be a JSON object.');
  }

  const normalized = {};
  for (const [rawPlan, rawPrice] of Object.entries(input)) {
    const plan = String(rawPlan || '').trim().toLowerCase();
    const priceId = String(rawPrice || '').trim();
    if (!PLAN_NAME.test(plan) || !PRICE_ID.test(priceId) || normalized[plan]) {
      throw new StripeCheckoutError('STRIPE_PRICE_MAP_INVALID', 'Stripe price map contains an invalid plan or price id.');
    }
    normalized[plan] = priceId;
  }

  if (!Object.keys(normalized).length) {
    throw new StripeCheckoutError('STRIPE_PRICE_MAP_INVALID', 'Stripe price map cannot be empty.');
  }
  return Object.freeze(normalized);
}

export function resolveStripePrice(plan, raw = process.env.STRIPE_PRICE_MAP_JSON) {
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  if (!PLAN_NAME.test(normalizedPlan)) {
    throw new StripeCheckoutError('STRIPE_PLAN_INVALID', 'Requested plan is invalid.');
  }
  const priceMap = parseStripePriceMap(raw);
  const priceId = priceMap[normalizedPlan];
  if (!priceId) {
    throw new StripeCheckoutError('STRIPE_PLAN_UNAVAILABLE', 'Requested plan is not configured for checkout.');
  }
  return { plan: normalizedPlan, priceId };
}

function publicOrigin(raw) {
  const source = String(raw || '').trim();
  if (!source) {
    throw new StripeCheckoutError('L99_PUBLIC_URL_UNCONFIGURED', 'L99 public URL is not configured.');
  }

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new StripeCheckoutError('L99_PUBLIC_URL_INVALID', 'L99 public URL is invalid.');
  }

  const localTest = process.env.NODE_ENV !== 'production'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !localTest) {
    throw new StripeCheckoutError('L99_PUBLIC_URL_INVALID', 'L99 public URL must use HTTPS.');
  }
  return url.origin;
}

export function buildCheckoutSessionForm({
  workspaceId,
  tenantId,
  plan,
  priceId,
  publicUrl
}) {
  const workspace = String(workspaceId || '').trim();
  const tenant = String(tenantId || '').trim();
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  const normalizedPrice = String(priceId || '').trim();

  if (!workspace || workspace.length > 128) {
    throw new StripeCheckoutError('WORKSPACE_INVALID', 'Workspace id is invalid.');
  }
  if (!PLAN_NAME.test(normalizedPlan) || !PRICE_ID.test(normalizedPrice)) {
    throw new StripeCheckoutError('CHECKOUT_PRODUCT_INVALID', 'Checkout product configuration is invalid.');
  }

  const origin = publicOrigin(publicUrl);
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', normalizedPrice);
  form.set('line_items[0][quantity]', '1');
  form.set('client_reference_id', workspace);
  form.set('metadata[workspace_id]', workspace);
  form.set('metadata[plan]', normalizedPlan);
  form.set('subscription_data[metadata][workspace_id]', workspace);
  form.set('subscription_data[metadata][plan]', normalizedPlan);
  if (tenant) {
    form.set('metadata[tenant_id]', tenant);
    form.set('subscription_data[metadata][tenant_id]', tenant);
  }
  form.set('success_url', `${origin}/front_door.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/front_door.html?checkout=cancelled`);
  return form.toString();
}

export function buildCheckoutIdempotencyKey({
  tenantId,
  actorId,
  workspaceId,
  plan,
  attemptId
}) {
  const fingerprint = JSON.stringify({
    tenant_id: String(tenantId || ''),
    actor_id: String(actorId || ''),
    workspace_id: String(workspaceId || ''),
    plan: String(plan || '').trim().toLowerCase(),
    attempt_id: String(attemptId || '')
  });
  return `l99_checkout_${createHash('sha256').update(fingerprint).digest('hex')}`;
}

export function stripeApiBaseUrl(env = process.env) {
  const override = String(env.STRIPE_API_BASE_URL || '').trim();
  if (!override) return OFFICIAL_STRIPE_API_BASE;
  if (env.NODE_ENV !== 'test') {
    throw new StripeCheckoutError('STRIPE_API_BASE_OVERRIDE_FORBIDDEN', 'Stripe API base override is test-only.');
  }

  let url;
  try {
    url = new URL(override);
  } catch {
    throw new StripeCheckoutError('STRIPE_API_BASE_INVALID', 'Stripe API base override is invalid.');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (!loopback || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new StripeCheckoutError('STRIPE_API_BASE_INVALID', 'Stripe API base override must be loopback in tests.');
  }
  return url.toString().replace(/\/$/, '');
}

export async function createStripeCheckoutSession({
  apiKey = process.env.STRIPE_SECRET_KEY,
  formBody,
  idempotencyKey,
  fetchImpl = globalThis.fetch
}) {
  const secret = String(apiKey || '').trim();
  if (!secret) {
    throw new StripeCheckoutError('STRIPE_SECRET_KEY_UNCONFIGURED', 'Stripe secret key is not configured.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new StripeCheckoutError('STRIPE_FETCH_UNAVAILABLE', 'Stripe transport is unavailable.');
  }

  let response;
  try {
    response = await fetchImpl(`${stripeApiBaseUrl()}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': String(idempotencyKey || '')
      },
      body: String(formBody || '')
    });
  } catch {
    throw new StripeCheckoutError('STRIPE_REQUEST_FAILED', 'Stripe checkout request failed.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new StripeCheckoutError('STRIPE_CHECKOUT_REJECTED', 'Stripe rejected checkout creation.', response.status);
  }

  const id = typeof data.id === 'string' ? data.id : '';
  const checkoutUrl = typeof data.url === 'string' ? data.url : '';
  if (!id || !checkoutUrl) {
    throw new StripeCheckoutError('STRIPE_CHECKOUT_INVALID_RESPONSE', 'Stripe checkout response was incomplete.');
  }

  try {
    const parsed = new URL(checkoutUrl);
    if (parsed.protocol !== 'https:') throw new Error('not https');
  } catch {
    throw new StripeCheckoutError('STRIPE_CHECKOUT_INVALID_RESPONSE', 'Stripe checkout URL was invalid.');
  }

  return { id, url: checkoutUrl };
}
