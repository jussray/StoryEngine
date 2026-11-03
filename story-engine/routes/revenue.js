// routes/revenue.js
// Revenue Engine routes: verified Stripe webhook receiver, subscription reads, notification log.

import { requireRole, requireWorkspaceAccess } from '../lib/securityContext.js';
import {
  handleStripeWebhook, getSubscription,
  revenueOverview
} from '../lib/revenueEngine.js';
import { listConversions as listIpConversions } from '../lib/ipStudio.js';
import { verifyStripeWebhookSignature } from '../lib/stripeWebhookSignature.js';
import {
  buildCheckoutIdempotencyKey,
  buildCheckoutSessionForm,
  createStripeCheckoutSession,
  resolveStripePrice,
  StripeCheckoutError
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
  const amountCandidate = object.amount_paid ?? object.amount_total ?? object.amount_received ?? object.amount_due ?? null;
  const amount = Number(amountCandidate);

  return {
    workspace_id: metadata.workspace_id || subscription.metadata?.workspace_id || null,
    customer: object.customer || null,
    subscription_id: typeof object.subscription === 'string' ? object.subscription : subscription.id || null,
    subscription,
    plan: metadata.plan || subscription.metadata?.plan || null,
    payment_status: typeof object.payment_status === 'string' ? object.payment_status : null,
    amount_cents: amountCandidate === null || !Number.isFinite(amount) ? null : amount,
    currency: typeof object.currency === 'string' ? object.currency : null,
    stripe_object_id: typeof object.id === 'string' ? object.id : null
  };
}

export default function revenueRoutes(router, db) {
  // Authenticated checkout creation. The browser supplies a plan name only;
  // the server owns the plan -> Stripe Price mapping and never accepts a
  // client-provided amount or price id.
  router.post('/api/revenue/checkout', requireRole('creator'), async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const workspace_id = String(body.workspace_id || '').trim();
    const requestedPlan = String(body.plan || '').trim();

    if (!workspace_id || !requestedPlan) {
      json(res, 400, { error: 'workspace_id_and_plan_required' });
      return;
    }
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;

    let selection;
    try {
      selection = resolveStripePrice(requestedPlan);
    } catch (error) {
      const code = error instanceof StripeCheckoutError ? error.code : 'STRIPE_CHECKOUT_CONFIG_INVALID';
      const status = code === 'STRIPE_PLAN_INVALID' || code === 'STRIPE_PLAN_UNAVAILABLE' ? 400 : 503;
      json(res, status, { error: code.toLowerCase() });
      return;
    }

    let formBody;
    try {
      formBody = buildCheckoutSessionForm({
        workspaceId: workspace_id,
        tenantId: req.auth?.tenant_id,
        plan: selection.plan,
        priceId: selection.priceId,
        publicUrl: process.env.L99_PUBLIC_URL
      });
    } catch (error) {
      const code = error instanceof StripeCheckoutError ? error.code : 'STRIPE_CHECKOUT_CONFIG_INVALID';
      json(res, 503, { error: code.toLowerCase() });
      return;
    }

    const idempotencyKey = buildCheckoutIdempotencyKey({
      tenantId: req.auth?.tenant_id,
      actorId: req.auth?.actor_id,
      workspaceId: workspace_id,
      plan: selection.plan,
      attemptId: body.checkout_attempt_id || req.request_id
    });

    try {
      const session = await createStripeCheckoutSession({ formBody, idempotencyKey });
      json(res, 201, {
        checkout_session_id: session.id,
        url: session.url,
        workspace_id,
        plan: selection.plan
      });
    } catch (error) {
      const code = error instanceof StripeCheckoutError ? error.code : 'STRIPE_CHECKOUT_CREATE_FAILED';
      const status = code.endsWith('_UNCONFIGURED') || code.includes('_INVALID') || code.includes('_FORBIDDEN') ? 503 : 502;
      json(res, status, { error: code.toLowerCase() });
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
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const sub = getSubscription(db, workspace_id);
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
    const { workspace_id } = req.params;
    if (!requireWorkspaceAccess(req, res, workspace_id)) return;
    try {
      const conversions = listIpConversions(db, workspace_id);
      json(res, 200, { conversions });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}
