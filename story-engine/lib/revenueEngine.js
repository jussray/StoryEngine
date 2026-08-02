// lib/revenueEngine.js
// Revenue Engine — Stripe webhook handler + subscription state + Resend notification hooks.
// Sits on top of the Bootstrap Engine's Stripe and Resend providers.
// The operator never pays a platform fee before payment processing begins.

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      subscription_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',
      current_period_end INTEGER,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON subscriptions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

    CREATE TABLE IF NOT EXISTS revenue_events (
      revenue_event_id TEXT PRIMARY KEY,
      stripe_event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      workspace_id TEXT,
      amount_cents INTEGER,
      currency TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      processed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revenue_events_created ON revenue_events(created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_log (
      notification_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resend_message_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_log_workspace ON notification_log(workspace_id, created_at DESC);
  `);
}

// ─── Subscription state ───────────────────────────────────────────────────────

export function getSubscription(db, workspace_id) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM subscriptions WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1').get(workspace_id) || null;
}

export function upsertSubscription(db, {
  workspace_id, stripe_customer_id, stripe_subscription_id,
  plan = 'free', status = 'inactive', current_period_end = null,
  cancel_at_period_end = false, metadata = {}
}) {
  ensureSchema(db);
  const existing = db.prepare('SELECT subscription_id FROM subscriptions WHERE workspace_id=?').get(workspace_id);
  const t = Date.now();
  if (existing) {
    db.prepare(`
      UPDATE subscriptions SET
        stripe_customer_id=?, stripe_subscription_id=?, plan=?, status=?,
        current_period_end=?, cancel_at_period_end=?, metadata_json=?, updated_at=?
      WHERE subscription_id=?
    `).run(
      stripe_customer_id || null, stripe_subscription_id || null,
      plan, status, current_period_end || null,
      cancel_at_period_end ? 1 : 0,
      JSON.stringify(metadata), t, existing.subscription_id
    );
    log(db, { workspace_id, mode: 'revenue_engine', event_type: 'subscription.updated', payload: { plan, status } });
    return { ...existing, plan, status, updated_at: t };
  }
  const subscription_id = `sub_${randomUUID()}`;
  db.prepare(`
    INSERT INTO subscriptions
      (subscription_id, workspace_id, stripe_customer_id, stripe_subscription_id, plan, status,
       current_period_end, cancel_at_period_end, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subscription_id, workspace_id, stripe_customer_id || null,
    stripe_subscription_id || null, plan, status,
    current_period_end || null, cancel_at_period_end ? 1 : 0,
    JSON.stringify(metadata), t, t
  );
  log(db, { workspace_id, mode: 'revenue_engine', event_type: 'subscription.created', payload: { plan, status } });
  return { subscription_id, workspace_id, plan, status, created_at: t, updated_at: t };
}

// ─── Stripe webhook handler ───────────────────────────────────────────────────

const HANDLED_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'checkout.session.completed'
]);

export function handleStripeWebhook(db, { stripe_event_id, event_type, payload = {} }) {
  ensureSchema(db);

  // Idempotency — skip already-processed events
  const existing = db.prepare('SELECT revenue_event_id, processed FROM revenue_events WHERE stripe_event_id=?').get(stripe_event_id);
  if (existing && existing.processed) return { skipped: true, reason: 'already_processed', stripe_event_id };

  const t = Date.now();
  const revenue_event_id = `rev_${randomUUID()}`;

  if (!existing) {
    db.prepare(`
      INSERT INTO revenue_events (revenue_event_id, stripe_event_id, event_type, workspace_id, amount_cents, currency, payload_json, processed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      revenue_event_id, stripe_event_id, event_type,
      payload.workspace_id || null,
      payload.amount_cents || null,
      payload.currency || null,
      JSON.stringify(payload), t
    );
  }

  if (!HANDLED_EVENTS.has(event_type)) {
    db.prepare('UPDATE revenue_events SET processed=1 WHERE stripe_event_id=?').run(stripe_event_id);
    return { handled: false, event_type, stripe_event_id };
  }

  const sub = payload.subscription || {};
  const workspace_id = payload.workspace_id || sub.metadata?.workspace_id || null;
  let result = { handled: true, event_type, stripe_event_id };

  if (workspace_id && (event_type.startsWith('customer.subscription') || event_type === 'checkout.session.completed')) {
    const updated = upsertSubscription(db, {
      workspace_id,
      stripe_customer_id: payload.customer || sub.customer || null,
      stripe_subscription_id: payload.subscription_id || sub.id || null,
      plan: sub.plan?.nickname || sub.items?.data?.[0]?.plan?.nickname || 'paid',
      status: event_type === 'customer.subscription.deleted' ? 'canceled' :
              event_type === 'checkout.session.completed' ? 'active' :
              sub.status || 'active',
      current_period_end: sub.current_period_end ? sub.current_period_end * 1000 : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      metadata: sub.metadata || {}
    });
    result.subscription = updated;
  }

  if (event_type === 'invoice.payment_succeeded' && workspace_id) {
    log(db, { workspace_id, mode: 'revenue_engine', event_type: 'invoice.paid', payload: { amount_cents: payload.amount_cents, currency: payload.currency } });
  }
  if (event_type === 'invoice.payment_failed' && workspace_id) {
    log(db, { workspace_id, mode: 'revenue_engine', event_type: 'invoice.failed', payload: { amount_cents: payload.amount_cents } });
  }

  db.prepare('UPDATE revenue_events SET processed=1 WHERE stripe_event_id=?').run(stripe_event_id);
  return result;
}

// ─── Resend notification hooks ────────────────────────────────────────────────

const RESEND_API = 'https://api.resend.com/emails';
const FROM_ADDRESS = process.env.RESEND_FROM || 'L99 <noreply@l99.app>';

async function sendViaResend(db, { workspace_id, kind, recipient, subject, html }) {
  ensureSchema(db);
  const notification_id = `notif_${randomUUID()}`;
  const t = Date.now();
  db.prepare(`
    INSERT INTO notification_log (notification_id, workspace_id, kind, recipient, subject, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(notification_id, workspace_id, kind, recipient, subject, t);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    db.prepare('UPDATE notification_log SET status=?, error=? WHERE notification_id=?')
      .run('skipped', 'RESEND_API_KEY not configured', notification_id);
    return { notification_id, status: 'skipped', reason: 'no_api_key' };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [recipient], subject, html })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Resend error ${res.status}`);
    db.prepare('UPDATE notification_log SET status=?, resend_message_id=? WHERE notification_id=?')
      .run('sent', data.id || null, notification_id);
    log(db, { workspace_id, mode: 'revenue_engine', event_type: 'notification.sent', payload: { kind, notification_id } });
    return { notification_id, status: 'sent', resend_message_id: data.id };
  } catch (err) {
    db.prepare('UPDATE notification_log SET status=?, error=? WHERE notification_id=?')
      .run('error', err.message, notification_id);
    return { notification_id, status: 'error', error: err.message };
  }
}

export async function sendWelcomeEmail(db, { workspace_id, recipient, name = 'Creator' }) {
  return sendViaResend(db, {
    workspace_id, kind: 'welcome', recipient,
    subject: 'Welcome to L99',
    html: `<p>Hi ${name},</p><p>Your story is ready. Head back to L99 to keep building.</p>`
  });
}

export async function sendPaymentReceiptEmail(db, { workspace_id, recipient, amount_dollars, plan }) {
  return sendViaResend(db, {
    workspace_id, kind: 'receipt', recipient,
    subject: `L99 receipt — $${amount_dollars}`,
    html: `<p>Payment received: $${amount_dollars} for the ${plan} plan. Thank you.</p>`
  });
}

export async function sendPaymentFailedEmail(db, { workspace_id, recipient }) {
  return sendViaResend(db, {
    workspace_id, kind: 'payment_failed', recipient,
    subject: 'L99 — payment issue',
    html: `<p>We could not process your last payment. Please update your payment method to keep your story running.</p>`
  });
}

export async function sendReleaseNotificationEmail(db, { workspace_id, recipient, title, format }) {
  return sendViaResend(db, {
    workspace_id, kind: 'release', recipient,
    subject: `Your ${format} is ready — ${title}`,
    html: `<p>"${title}" has passed the release gate and is ready for distribution in ${format} format. Log in to L99 to download or publish.</p>`
  });
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export function revenueOverview(db) {
  ensureSchema(db);
  const totalEvents = db.prepare('SELECT COUNT(*) as n FROM revenue_events').get()?.n || 0;
  const paidSubs = db.prepare("SELECT COUNT(*) as n FROM subscriptions WHERE status='active' AND plan != 'free'").get()?.n || 0;
  const freeSubs = db.prepare("SELECT COUNT(*) as n FROM subscriptions WHERE plan='free'").get()?.n || 0;
  const failedPayments = db.prepare("SELECT COUNT(*) as n FROM revenue_events WHERE event_type='invoice.payment_failed' AND processed=1").get()?.n || 0;
  const notificationsSent = db.prepare("SELECT COUNT(*) as n FROM notification_log WHERE status='sent'").get()?.n || 0;
  return {
    paid_subscriptions: paidSubs,
    free_subscriptions: freeSubs,
    total_revenue_events: totalEvents,
    failed_payments: failedPayments,
    notifications_sent: notificationsSent,
    stripe_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    resend_configured: Boolean(process.env.RESEND_API_KEY)
  };
}
