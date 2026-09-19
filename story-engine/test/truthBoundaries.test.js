import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../lib/sqliteTransaction.js';
import { createRouter, json } from '../lib/miniRouter.js';
import { verifyStripeWebhookSignature } from '../lib/stripeWebhookSignature.js';
import { completeWithReceipt, llmRoutingSnapshot } from '../lib/llmClient.js';
import { assertWorkspaceAccess } from '../lib/securityContext.js';
import * as Story from '../models/storyModel.js';
import { importBusinessMetricsCsv, listBusinessMetrics, businessMetricsSummary } from '../lib/businessMetrics.js';
import revenueRoutes from '../routes/revenue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

function responseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    write(chunk = '') { this.body += String(chunk); },
    end(chunk = '') {
      this.body += String(chunk);
      this.writableEnded = true;
    }
  };
}

function request(method, url, headers = {}, body = null) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.resume = () => {};
  queueMicrotask(() => {
    if (body !== null) req.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
    req.emit('end');
  });
  return req;
}

async function settled() {
  await new Promise(resolve => setImmediate(resolve));
}

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
}

function createTenantDb() {
  return createDb();
}

function createMetricsDb() {
  return createDb();
}

function captureRevenueRoutes(db) {
  const handlers = new Map();
  const router = {
    get(path, ...routeHandlers) { handlers.set(`GET ${path}`, routeHandlers.at(-1)); },
    post(path, ...routeHandlers) { handlers.set(`POST ${path}`, routeHandlers.at(-1)); }
  };
  revenueRoutes(router, db);
  return handlers;
}

test('canonical schema includes ownership and business metric truth tables', () => {
  const db = createDb();
  try {
    const storyColumns = db.prepare('PRAGMA table_info(stories)').all().map(row => row.name);
    assert.ok(storyColumns.includes('tenant_id'));
    assert.ok(storyColumns.includes('created_by_actor_id'));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_memberships'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_metric_observations'").get());
  } finally {
    db.close();
  }
});

test('miniRouter executes route middleware and final handler in order', async () => {
  const router = createRouter();
  const order = [];
  router.get('/proof', (req, res, next) => {
    order.push('guard');
    next();
  }, (req, res) => {
    order.push('handler');
    json(res, 200, { ok: true });
  });

  const req = request('GET', '/proof');
  const res = responseRecorder();
  router.handle(req, res);
  await settled();

  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, ['guard', 'handler']);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('miniRouter preserves exact bounded raw CSV bytes', async () => {
  const router = createRouter({ maxBodyBytes: 1024 });
  const csv = 'observed_at,metric_name,metric_value,unit\n2026-09-15T00:00:00Z,impressions,0,count\n';
  router.post('/import', (req, res) => {
    json(res, 200, {
      raw: req.rawBody.toString('utf8'),
      parsed: req.body
    });
  });

  const req = request('POST', '/import', {
    'content-type': 'text/csv',
    'content-length': String(Buffer.byteLength(csv))
  }, csv);
  const res = responseRecorder();
  router.handle(req, res);
  await settled();

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).raw, csv);
  assert.equal(JSON.parse(res.body).parsed, csv);
});

test('Stripe webhook signature verification rejects tampering and stale timestamps', () => {
  const secret = 'whsec_test_only_not_a_real_secret';
  const rawBody = Buffer.from('{"id":"evt_test","type":"checkout.session.completed"}');
  const timestamp = 1_789_500_000;
  const digest = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest('hex');
  const signatureHeader = `t=${timestamp},v1=${digest}`;
  const nowMs = timestamp * 1000;

  assert.equal(verifyStripeWebhookSignature({ rawBody, signatureHeader, secret, nowMs }).verified, true);
  assert.equal(verifyStripeWebhookSignature({
    rawBody: Buffer.from('{"id":"evt_tampered"}'), signatureHeader, secret, nowMs
  }).reason, 'signature_mismatch');
  assert.equal(verifyStripeWebhookSignature({
    rawBody, signatureHeader, secret, nowMs: nowMs + 301_000
  }).reason, 'signature_timestamp_outside_tolerance');
});

test('Stripe webhook fails closed when verification secret is unavailable in any environment', async () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const db = createDb();
  try {
    const handlers = captureRevenueRoutes(db);
    const res = responseRecorder();
    await handlers.get('POST /api/revenue/stripe/webhook')({
      headers: {},
      rawBody: Buffer.from('{"id":"evt_unsigned","type":"checkout.session.completed"}'),
      body: { id: 'evt_unsigned', type: 'checkout.session.completed' }
    }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { error: 'stripe_webhook_unconfigured' });
  } finally {
    db.close();
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  }
});

test('Anthropic request uses required headers, current model defaults, and transport-owned provenance', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalVersion = process.env.ANTHROPIC_VERSION;
  const sentinel = 'test-key-value-that-must-not-leak';
  process.env.ANTHROPIC_API_KEY = sentinel;
  delete process.env.ANTHROPIC_VERSION;

  let captured;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: '{"provider":"evil-model-output"}' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const receipt = await completeWithReceipt('safe prompt', { provider: 'anthropic', maxRetries: 0 });
    const body = JSON.parse(captured.init.body);
    assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(captured.init.headers['x-api-key'], sentinel);
    assert.equal(captured.init.headers['anthropic-version'], '2023-06-01');
    assert.equal(body.model, 'claude-sonnet-5');
    assert.equal(Object.hasOwn(body, 'temperature'), false);
    assert.equal(captured.init.body.includes(sentinel), false);
    assert.equal(receipt.provenance.provider, 'anthropic');
    assert.equal(receipt.provenance.requested_model, 'claude-sonnet-5');
    assert.equal(receipt.text, '{"provider":"evil-model-output"}');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalVersion === undefined) delete process.env.ANTHROPIC_VERSION;
    else process.env.ANTHROPIC_VERSION = originalVersion;
  }
});

test('Anthropic reflected error body cannot leak API key into exception or circuit snapshot', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const sentinel = 'test-reflected-key-value';
  process.env.ANTHROPIC_API_KEY = sentinel;
  global.fetch = async () => new Response(JSON.stringify({
    type: 'error',
    error: { type: 'authentication_error', message: `reflected ${sentinel}` }
  }), { status: 401, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => completeWithReceipt('safe prompt', { provider: 'anthropic', maxRetries: 0 }),
      error => {
        assert.equal(String(error.message).includes(sentinel), false);
        assert.match(String(error.message), /status 401/);
        return true;
      }
    );
    assert.equal(JSON.stringify(llmRoutingSnapshot()).includes(sentinel), false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});


test('Anthropic oversized success body fails closed without leaking content or API key', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const sentinel = 'test-success-key-value';
  const reflected = `provider-output-${sentinel}-${'x'.repeat(4096)}`;
  process.env.ANTHROPIC_API_KEY = sentinel;
  global.fetch = async () => new Response(JSON.stringify({
    id: 'msg_oversized',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: reflected }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => completeWithReceipt('safe prompt', {
        provider: 'anthropic',
        maxRetries: 0,
        successBodyMaxBytes: 1024
      }),
      error => {
        assert.equal(error.code, 'llm_provider_response_too_large');
        assert.equal(String(error.message).includes(sentinel), false);
        assert.equal(String(error.message).includes('provider-output'), false);
        return true;
      }
    );
    assert.equal(JSON.stringify(llmRoutingSnapshot()).includes(sentinel), false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test('story creation records durable tenant membership and legacy null ownership fails closed', () => {
  const db = createTenantDb();
  try {
    const a = Story.create(db, {
      title: 'Tenant A Story', tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator'
    });
    const b = Story.create(db, {
      title: 'Tenant B Story', tenant_id: 'tenant-b', actor_id: 'actor-b', role: 'creator'
    });
    db.prepare(`INSERT INTO stories (workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run('legacy-workspace', 'Legacy', Date.now(), Date.now());

    const aStories = Story.list(db, {
      tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['*']
    });
    assert.deepEqual(aStories.map(item => item.workspace_id), [a]);

    const adminStories = Story.list(db, {
      tenant_id: 'tenant-a', actor_id: 'admin-a', role: 'administrator', workspace_ids: ['*']
    });
    assert.equal(adminStories.some(item => item.workspace_id === a), true);
    assert.equal(adminStories.some(item => item.workspace_id === 'legacy-workspace'), false);
    assert.equal(adminStories.some(item => item.workspace_id === b), false);

    const requestA = {
      db,
      auth: { tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['*'] }
    };
    assert.equal(assertWorkspaceAccess(requestA, a), true);
    assert.equal(assertWorkspaceAccess(requestA, b), false);

    const legacyAdmin = {
      db,
      auth: { tenant_id: 'tenant-a', actor_id: 'admin-a', role: 'administrator', workspace_ids: ['*'] }
    };
    assert.equal(assertWorkspaceAccess(legacyAdmin, 'legacy-workspace'), false);

    db.prepare(`
      INSERT INTO workspace_memberships (workspace_id, tenant_id, actor_id, role, created_at)
      VALUES (?, ?, ?, 'creator', ?)
    `).run('legacy-workspace', 'tenant-a', 'actor-a', Date.now());
    const migratedLegacy = Story.list(db, {
      tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['legacy-workspace']
    });
    assert.deepEqual(migratedLegacy.map(item => item.workspace_id), ['legacy-workspace']);
    assert.equal(assertWorkspaceAccess({
      db,
      auth: { tenant_id: 'tenant-a', actor_id: 'actor-a', role: 'creator', workspace_ids: ['legacy-workspace'] }
    }, 'legacy-workspace'), true);
  } finally {
    db.close();
  }
});

test('business metrics preserve identity, provenance, null-vs-zero, history and idempotency', () => {
  const db = createMetricsDb();
  try {
    const csv = [
      'observed_at,metric_name,metric_value,unit,content_id',
      '2026-09-01T12:00:00Z,impressions,0,count,post-1',
      '2026-09-01T12:00:00Z,clicks,,count,post-1'
    ].join('\n');
    const defaults = {
      workspace_id: 'workspace-a',
      audience_segment: 'founders',
      source: 'metricool:facebook',
      account_id: 'brand-123',
      page_id: 'page-456',
      provenance: { connector: 'metricool', import_receipt: 'safe-test-receipt' }
    };

    const first = importBusinessMetricsCsv(db, csv, defaults);
    const replay = importBusinessMetricsCsv(db, csv, defaults);
    assert.equal(first.written, 2);
    assert.equal(first.missing_values, 1);
    assert.equal(replay.written, 0);
    assert.equal(replay.duplicates, 2);

    const rows = listBusinessMetrics(db, 'workspace-a');
    const impressions = rows.find(row => row.metric_name === 'impressions');
    const clicks = rows.find(row => row.metric_name === 'clicks');
    assert.equal(impressions.metric_value, 0);
    assert.equal(impressions.value_state, 'observed');
    assert.equal(clicks.metric_value, null);
    assert.equal(clicks.value_state, 'missing');
    assert.equal(impressions.source, 'metricool:facebook');
    assert.equal(impressions.account_id, 'brand-123');
    assert.equal(impressions.page_id, 'page-456');
    assert.equal(impressions.audience_segment, 'founders');
    assert.equal(impressions.historical, true);
    assert.equal(impressions.provenance.connector, 'metricool');

    const summary = businessMetricsSummary(db, 'workspace-a');
    assert.equal(summary.metrics.length, 2);
  } finally {
    db.close();
  }
});

test('business metric CSV import is atomic when a later row is invalid', () => {
  const db = createMetricsDb();
  try {
    const csv = [
      'observed_at,metric_name,metric_value,unit',
      '2026-09-01T12:00:00Z,impressions,100,count',
      '2026-09-02T12:00:00Z,impressions,not-a-number,count'
    ].join('\n');
    assert.throws(() => importBusinessMetricsCsv(db, csv, {
      workspace_id: 'workspace-a',
      audience_segment: 'founders',
      source: 'metricool:facebook',
      account_id: 'brand-123'
    }), /metric_value must be finite/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_metric_observations').get().count, 0);
  } finally {
    db.close();
  }
});

test('business metrics summary separates actual latest value from historical maximum', () => {
  const db = createMetricsDb();
  try {
    const csv = [
      'observed_at,metric_name,metric_value,unit',
      '2026-09-01T12:00:00Z,impressions,100,count',
      '2026-09-02T12:00:00Z,impressions,20,count'
    ].join('\n');
    importBusinessMetricsCsv(db, csv, {
      workspace_id: 'workspace-a',
      audience_segment: 'founders',
      source: 'metricool:facebook',
      account_id: 'brand-123'
    });
    const metric = businessMetricsSummary(db, 'workspace-a').metrics.find(item => item.metric_name === 'impressions');
    assert.equal(metric.latest_value, 20);
    assert.equal(metric.max_observed_value, 100);
    assert.equal(metric.latest_value_state, 'observed');
    assert.equal(metric.latest_value_observed_at, Date.parse('2026-09-02T12:00:00Z'));
  } finally {
    db.close();
  }
});
