import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`StoryEngine exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('StoryEngine health check timed out');
}

function stripeSignature(secret, raw) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret)
    .update(Buffer.from(`${timestamp}.${raw}`, 'utf8'))
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test.describe('governed Stripe checkout boundary', () => {
  test.describe.configure({ mode: 'serial' });

  let stripeServer;
  let storyProcess;
  let stripeOrigin;
  let storyOrigin;
  let tempDir;
  let lastStripeRequest = null;

  test.beforeAll(async () => {
    const stripePort = await freePort();
    const storyPort = await freePort();
    stripeOrigin = `http://127.0.0.1:${stripePort}`;
    storyOrigin = `http://127.0.0.1:${storyPort}`;
    tempDir = mkdtempSync(join(tmpdir(), 'l99-stripe-playwright-'));

    stripeServer = createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        lastStripeRequest = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8')
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'cs_test_governed',
          url: 'https://checkout.stripe.com/c/pay/governed-test'
        }));
      });
    });
    await new Promise((resolve, reject) => {
      stripeServer.once('error', reject);
      stripeServer.listen(stripePort, '127.0.0.1', resolve);
    });

    storyProcess = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(storyPort),
        NODE_ENV: 'test',
        L99_DB_PATH: join(tempDir, 'l99.db'),
        EXPECTED_HEAD_SHA: 'b'.repeat(40),
        L99_RELEASE_SHA: 'b'.repeat(40),
        L99_API_KEYS_JSON: JSON.stringify([{
          key: 'stripe-playwright-admin',
          actor_id: 'stripe-playwright',
          tenant_id: 'playwright',
          role: 'administrator',
          workspace_ids: ['*']
        }]),
        STRIPE_SECRET_KEY: 'sk_test_governed',
        STRIPE_WEBHOOK_SECRET: 'whsec_governed',
        STRIPE_PRICE_MAP_JSON: JSON.stringify({ pro: 'price_test_pro' }),
        STRIPE_API_BASE_URL: `${stripeOrigin}/v1`,
        L99_PUBLIC_URL: storyOrigin,
        RUNTIME_SCAN_INTERVAL_MS: '3600000',
        RUNTIME_DRAIN_INTERVAL_MS: '3600000'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await waitForHealth(storyOrigin, storyProcess);
  });

  test.afterAll(async () => {
    if (storyProcess && storyProcess.exitCode === null) {
      storyProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 150));
      if (storyProcess.exitCode === null) storyProcess.kill('SIGKILL');
    }
    if (stripeServer) {
      await new Promise(resolve => stripeServer.close(resolve));
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates checkout from a server allowlist and waits for subscription authority', async ({ request }) => {
    const auth = { 'x-api-key': 'stripe-playwright-admin' };

    const checkout = await request.post(`${storyOrigin}/api/revenue/checkout`, {
      headers: auth,
      data: {
        workspace_id: 'ws_checkout_e2e',
        plan: 'pro',
        checkout_attempt_id: 'attempt-e2e-1'
      }
    });
    expect(checkout.status()).toBe(201);
    const checkoutBody = await checkout.json();
    expect(checkoutBody).toMatchObject({
      checkout_session_id: 'cs_test_governed',
      workspace_id: 'ws_checkout_e2e',
      plan: 'pro'
    });
    expect(checkoutBody.url).toContain('checkout.stripe.com');

    expect(lastStripeRequest?.method).toBe('POST');
    expect(lastStripeRequest?.url).toBe('/v1/checkout/sessions');
    const form = new URLSearchParams(lastStripeRequest?.body || '');
    expect(form.get('mode')).toBe('subscription');
    expect(form.get('line_items[0][price]')).toBe('price_test_pro');
    expect(form.get('metadata[workspace_id]')).toBe('ws_checkout_e2e');
    expect([...form.keys()].some(key => key.includes('unit_amount'))).toBe(false);
    expect(lastStripeRequest?.headers['idempotency-key']).toMatch(/^l99_checkout_[0-9a-f]{64}$/);

    const checkoutEvent = JSON.stringify({
      id: 'evt_checkout_completed_e2e',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_governed',
          customer: 'cus_test',
          subscription: 'sub_test',
          payment_status: 'paid',
          metadata: { workspace_id: 'ws_checkout_e2e', plan: 'pro' }
        }
      }
    });
    const checkoutWebhook = await request.post(`${storyOrigin}/api/revenue/stripe/webhook`, {
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignature('whsec_governed', checkoutEvent)
      },
      data: checkoutEvent
    });
    expect(checkoutWebhook.status()).toBe(200);

    let subscription = await request.get(`${storyOrigin}/api/revenue/subscription/ws_checkout_e2e`, { headers: auth });
    expect(subscription.status()).toBe(200);
    expect((await subscription.json()).subscription).toBeNull();

    const subscriptionEvent = JSON.stringify({
      id: 'evt_subscription_created_e2e',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 3600,
          cancel_at_period_end: false,
          metadata: { workspace_id: 'ws_checkout_e2e', plan: 'pro' }
        }
      }
    });
    const subscriptionWebhook = await request.post(`${storyOrigin}/api/revenue/stripe/webhook`, {
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignature('whsec_governed', subscriptionEvent)
      },
      data: subscriptionEvent
    });
    expect(subscriptionWebhook.status()).toBe(200);

    subscription = await request.get(`${storyOrigin}/api/revenue/subscription/ws_checkout_e2e`, { headers: auth });
    expect(subscription.status()).toBe(200);
    const subscriptionBody = await subscription.json();
    expect(subscriptionBody.subscription).toMatchObject({
      workspace_id: 'ws_checkout_e2e',
      stripe_subscription_id: 'sub_test',
      plan: 'pro',
      status: 'active'
    });
  });
});
