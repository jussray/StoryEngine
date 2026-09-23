import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2026-07-29.dahlia';

let cachedKey = '';
let cachedClient = null;

/**
 * Return a process-scoped Stripe client only when a server-side key exists.
 * The secret is never exported or copied into logs, responses, or client code.
 */
export function getStripeClient() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;

  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 20_000
    });
    cachedKey = key;
  }

  return cachedClient;
}
