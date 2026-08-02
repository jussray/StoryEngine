// routes/revenue.js
// Revenue Engine routes: Stripe webhook receiver, subscription reads, notification log.

import { requireRole } from '../lib/securityContext.js';
import {
  handleStripeWebhook, getSubscription,
  revenueOverview, listConversions
} from '../lib/revenueEngine.js';
import { listConversions as listIpConversions } from '../lib/ipStudio.js';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export default function revenueRoutes(router, db) {
  // Stripe webhook — no auth (verified by signature in production via STRIPE_WEBHOOK_SECRET)
  router.post('/api/revenue/stripe/webhook', async (req, res) => {
    try {
      const sig = req.headers['stripe-signature'] || '';
      const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
      // Signature verification: in production, use stripe.webhooks.constructEvent().
      // Here we verify the secret header is present when configured.
      if (secret && !sig) {
        json(res, 400, { error: 'Missing stripe-signature header.' });
        return;
      }
      const { stripe_event_id, event_type, payload = {} } = req.body || {};
      if (!stripe_event_id || !event_type) {
        json(res, 400, { error: 'stripe_event_id and event_type are required.' });
        return;
      }
      const result = handleStripeWebhook(db, { stripe_event_id, event_type, payload });
      json(res, 200, result);
    } catch (err) {
      json(res, 500, { error: err.message });
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
