// routes/revenue.js
// Revenue Engine routes: verified Stripe webhook receiver, subscription reads, notification log.

import { requireRole } from '../lib/securityContext.js';
import {
  handleStripeWebhook, getSubscription,
  revenueOverview, listConversions
} from '../lib/revenueEngine.js';
import { listConversions as listIpConversions } from '../lib/ipStudio.js';
import { verifyStripeWebhookSignature } from '../lib/stripeWebhookSignature.js';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function normalizedStripePayload(event) {
  const object = event?.data?.object && typeof event.data.object === 'object' ? event.data.object : {};
  const eventType = String(event?.type || '');
  const metadata = object.metadata && typeof object.metadata === 'object' ? object.metadata : {};
  const subscription = eventType.startsWith('customer.subscription') ? object : {};
  const amountCandidate = object.amount_paid ?? object.amount_total ?? object.amount_received ?? object.amount_due ?? null;
  const amount = Number(amountCandidate);

  return {
    workspace_id: metadata.workspace_id || subscription.metadata?.workspace_id || null,
    customer: object.customer || null,
    subscription_id: typeof object.subscription === 'string' ? object.subscription : subscription.id || null,
    subscription,
    amount_cents: amountCandidate === null || !Number.isFinite(amount) ? null : amount,
    currency: typeof object.currency === 'string' ? object.currency : null,
    stripe_object_id: typeof object.id === 'string' ? object.id : null
  };
}

export default function revenueRoutes(router, db) {
  // Stripe webhook — authenticated by Stripe's signature, not the normal creator API key.
  router.post('/api/revenue/stripe/webhook', async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'] || '';
      const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();

      if (!secret) {
        json(res, 503, { error: 'stripe_webhook_unconfigured' });
        return;
      }

      const verification = verifyStripeWebhookSignature({
        rawBody: req.rawBody,
        signatureHeader: signature,
        secret
      });
      if (!verification.verified) {
        json(res, 400, { error: 'invalid_stripe_signature', reason: verification.reason });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const stripe_event_id = String(body.id || body.stripe_event_id || '').trim();
      const event_type = String(body.type || body.event_type || '').trim();
      if (!stripe_event_id || !event_type) {
        json(res, 400, { error: 'invalid_stripe_event' });
        return;
      }

      const payload = body.payload && typeof body.payload === 'object'
        ? body.payload
        : normalizedStripePayload(body);
      const result = handleStripeWebhook(db, { stripe_event_id, event_type, payload });
      json(res, 200, { ...result, signature_verified: true });
    } catch (err) {
      json(res, 500, { error: 'webhook_processing_failed', message: err.message });
    }
  });

  // Subscription state for a workspace
  router.get('/api/revenue/subscription/:workspace_id', (req, res) => {
    try {
      const sub = getSubscription(db, req.params.workspace_id);
      json(res, 200, { subscription: sub });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  // Operator overview — administrator only
  router.get('/api/revenue/overview', requireRole('administrator'), (req, res) => {
    try {
      json(res, 200, revenueOverview(db));
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  // IP conversions for a workspace
  router.get('/api/revenue/conversions/:workspace_id', (req, res) => {
    try {
      const conversions = listIpConversions(db, req.params.workspace_id);
      json(res, 200, { conversions });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}
