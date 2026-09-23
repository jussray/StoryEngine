// routes/revenue.js
// Revenue Engine routes: governed Stripe checkout, verified webhooks, subscription reads.

import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';
import {
  handleStripeWebhook, getSubscription,
  revenueOverview
} from '../lib/revenueEngine.js';
import { listConversions as listIpConversions } from '../lib/ipStudio.js';
import { verifyStripeWebhookSignature } from '../lib/stripeWebhookSignature.js';
import { getStripeClient } from '../lib/stripeClient.js';
import {
  buildCheckoutIdempotencyKey,
  buildSubscriptionCheckoutParams,
  resolveStripePrice
} from '../lib/stripeCheckout.js';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function normalizedStripePayload(event) {
  const object = event?.data?.object && typeof event.data.object === 'object' ? event.data.object : {};
  const eventType = String(event?.type || '');
  const metadata = object.metadata && typeof object.metadata === 'object' ? object.metadata : {};
  const subscription = eventType.startsWith('customer.subscription') ? object : {};
  const subscriptionMetadata = subscription.metadata && typeof subscription.metadata === 'object' ? subscription.metadata : {};
  const amountCandidate = object.amount_paid ?? object.amount_total ?? object.amount_received ?? object.amount_due ?? null;
  const amount = Number(amountCandidate);

  return {
    workspace_id: metadata.workspace_id || subscriptionMetadata.workspace_id || null,
    plan: metadata.plan || subscriptionMetadata.plan || null,
    customer: object.customer || null,
    subscription_id: typeof object.subscription === 'string' ? object.subscription : subscription.id || null,
    subscription,
    payment_status: typeof object.payment_status === 'string' ? object.payment_status : null,
    amount_cents: amountCandidate === null || !Number.isFinite(amount) ? null : amount,
    currency: typeof object.currency === 'string' ? object.currency : null,
    stripe_object_id: typeof object.id === 'string' ? object.id : null
  };
}

export default function revenueRoutes(router, db) {
  // Authenticated creator checkout. Price authority remains server-side: the
  // browser sends a plan name, never an arbitrary Stripe price or amount.
  router.post('/api/revenue/checkout', requireRole('creator'), async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const workspace_id = String(body.workspace_id || '').trim();
    const requestedPlan = String(body.plan || '').trim().toLowerCase();

    if (!workspace_id || !requestedPlan) {
      json(res, 400, { error: 'workspace_id_and_plan_required' });
      return;
    }
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;

    const stripe = getStripeClient();
    if (!stripe) {
      json(res, 503, { error: 'stripe_checkout_unconfigured' });
      return;
    }

    let plan;
    let priceId;
    try {
      ({ plan, priceId } = resolveStripePrice(requestedPlan));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid_plan';
      const status = message.startsWith('No Stripe price') ? 503 : 400;
      json(res, status, { error: status === 503 ? 'stripe_price_unconfigured' : 'invalid_plan' });
      return;
    }

    let params;
    let idempotencyKey;
    try {
      params = buildSubscriptionCheckoutParams({
        workspaceId: workspace_id,
        plan,
        priceId,
        publicUrl: process.env.L99_PUBLIC_URL
      });
      idempotencyKey = buildCheckoutIdempotencyKey({
        tenantId: req.auth?.tenant_id,
        actorId: req.auth?.actor_id,
        workspaceId: workspace_id,
        plan,
        attemptId: body.checkout_attempt_id || req.request_id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const configError = message.includes('L99_PUBLIC_URL');
      json(res, configError ? 503 : 400, { error: configError ? 'stripe_checkout_url_unconfigured' : 'invalid_checkout_request' });
      return;
    }

    try {
      const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
      if (!session.url) {
        json(res, 502, { error: 'stripe_checkout_url_missing' });
        return;
      }
      json(res, 201, {
        checkout_session_id: session.id,
        url: session.url,
        workspace_id,
        plan
      });
    } catch {
      json(res, 502, { error: 'stripe_checkout_create_failed' });
    }
  });

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
      json(res, 200, { conversions: listIpConversions(db, req.params.workspace_id) });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}
