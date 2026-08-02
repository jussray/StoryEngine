import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  upsertSubscription, getSubscription,
  handleStripeWebhook, revenueOverview
} from '../lib/revenueEngine.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    mode TEXT,
    event_type TEXT NOT NULL,
    payload TEXT,
    duration_ms INTEGER,
    rollback INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER
  )`);
  return db;
}

test('upsertSubscription creates and retrieves a subscription', () => {
  const db = makeDb();
  upsertSubscription(db, { workspace_id: 'ws1', plan: 'pro', status: 'active' });
  const sub = getSubscription(db, 'ws1');
  assert.ok(sub);
  assert.strictEqual(sub.plan, 'pro');
  assert.strictEqual(sub.status, 'active');
});

test('upsertSubscription updates an existing subscription', () => {
  const db = makeDb();
  upsertSubscription(db, { workspace_id: 'ws2', plan: 'free', status: 'inactive' });
  upsertSubscription(db, { workspace_id: 'ws2', plan: 'pro', status: 'active' });
  const sub = getSubscription(db, 'ws2');
  assert.strictEqual(sub.plan, 'pro');
  assert.strictEqual(sub.status, 'active');
});

test('handleStripeWebhook is idempotent on duplicate event', () => {
  const db = makeDb();
  const event = { stripe_event_id: 'evt_001', event_type: 'invoice.payment_succeeded', payload: { workspace_id: 'ws3', amount_cents: 2000 } };
  handleStripeWebhook(db, event);
  const second = handleStripeWebhook(db, event);
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.reason, 'already_processed');
});

test('handleStripeWebhook creates subscription on checkout.session.completed', () => {
  const db = makeDb();
  handleStripeWebhook(db, {
    stripe_event_id: 'evt_002',
    event_type: 'checkout.session.completed',
    payload: { workspace_id: 'ws4', customer: 'cus_abc', subscription: { id: 'sub_xyz', status: 'active', metadata: { workspace_id: 'ws4' } } }
  });
  const sub = getSubscription(db, 'ws4');
  assert.ok(sub);
  assert.strictEqual(sub.status, 'active');
});

test('handleStripeWebhook marks subscription canceled on deletion', () => {
  const db = makeDb();
  upsertSubscription(db, { workspace_id: 'ws5', plan: 'pro', status: 'active' });
  handleStripeWebhook(db, {
    stripe_event_id: 'evt_003',
    event_type: 'customer.subscription.deleted',
    payload: { workspace_id: 'ws5', subscription: { metadata: { workspace_id: 'ws5' } } }
  });
  const sub = getSubscription(db, 'ws5');
  assert.strictEqual(sub.status, 'canceled');
});

test('revenueOverview returns expected shape', () => {
  const db = makeDb();
  const overview = revenueOverview(db);
  assert.ok('paid_subscriptions' in overview);
  assert.ok('free_subscriptions' in overview);
  assert.ok('total_revenue_events' in overview);
  assert.ok('stripe_configured' in overview);
  assert.ok('resend_configured' in overview);
});
