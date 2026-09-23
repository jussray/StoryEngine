import { createHash } from 'node:crypto';

export const STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER = 'l99_checkout_nqvtpsla';

const PLAN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PRICE = /^price_[A-Za-z0-9]+$/;
const ATTEMPT = /^[A-Za-z0-9._:-]{8,128}$/;

export function parseStripePriceMap(raw = process.env.L99_STRIPE_PRICE_MAP_JSON) {
  const text = String(raw || '').trim();
  if (!text) return {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('L99_STRIPE_PRICE_MAP_JSON must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('L99_STRIPE_PRICE_MAP_JSON must be a plan-to-price object.');
  }

  const result = {};
  for (const [rawPlan, rawPrice] of Object.entries(parsed)) {
    const plan = String(rawPlan || '').trim().toLowerCase();
    const priceId = String(rawPrice || '').trim();
    if (!PLAN.test(plan) || !PRICE.test(priceId)) {
      throw new Error(`Invalid Stripe plan mapping for ${rawPlan}.`);
    }
    result[plan] = priceId;
  }
  return result;
}

export function resolveStripePrice(plan, raw = process.env.L99_STRIPE_PRICE_MAP_JSON) {
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  if (!PLAN.test(normalizedPlan)) throw new Error('Invalid plan.');
  const priceId = parseStripePriceMap(raw)[normalizedPlan];
  if (!priceId) throw new Error(`No Stripe price is configured for plan ${normalizedPlan}.`);
  return { plan: normalizedPlan, priceId };
}

export function checkoutOrigin(raw = process.env.L99_PUBLIC_URL) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('L99_PUBLIC_URL is not configured.');
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) {
    throw new Error('L99_PUBLIC_URL must use HTTPS outside localhost.');
  }
  return url.origin;
}

export function buildSubscriptionCheckoutParams({ workspaceId, plan, priceId, publicUrl }) {
  const workspace = String(workspaceId || '').trim();
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  const normalizedPrice = String(priceId || '').trim();
  if (!workspace || workspace.length > 128) throw new Error('Invalid workspace_id.');
  if (!PLAN.test(normalizedPlan)) throw new Error('Invalid plan.');
  if (!PRICE.test(normalizedPrice)) throw new Error('Invalid Stripe price id.');
  const origin = checkoutOrigin(publicUrl);

  return {
    mode: 'subscription',
    line_items: [{ price: normalizedPrice, quantity: 1 }],
    client_reference_id: workspace,
    metadata: { workspace_id: workspace, plan: normalizedPlan },
    subscription_data: { metadata: { workspace_id: workspace, plan: normalizedPlan } },
    success_url: `${origin}/story_engine.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/story_engine.html?checkout=cancelled`,
    integration_identifier: STRIPE_CHECKOUT_INTEGRATION_IDENTIFIER
  };
}

export function buildCheckoutIdempotencyKey({ tenantId, actorId, workspaceId, plan, attemptId }) {
  const attempt = String(attemptId || '').trim();
  if (!ATTEMPT.test(attempt)) throw new Error('Invalid checkout_attempt_id.');
  const material = [tenantId, actorId, workspaceId, plan, attempt].map(value => String(value || '').trim()).join('|');
  return `l99-checkout-${createHash('sha256').update(material).digest('hex').slice(0, 48)}`;
}
