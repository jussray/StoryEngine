import { test, expect } from '@playwright/test';

const creatorHeaders = {
  'x-api-key': 'playwright-tenant-creator-key',
  'content-type': 'application/json'
};

async function createWorkspace(request) {
  const response = await request.post('/api/story', {
    headers: creatorHeaders,
    data: {
      title: `Stripe Checkout Proof ${Date.now()}`,
      genre: 'verification',
      pitch: 'Playwright-only workspace for checkout authority proof.'
    }
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.workspace_id).toBeTruthy();
  return payload.workspace_id;
}

test('checkout route enforces auth and workspace authority before Stripe and fails closed when provider config is absent', async ({ request }) => {
  const workspaceId = await createWorkspace(request);
  const payload = {
    workspace_id: workspaceId,
    plan: 'pro',
    checkout_attempt_id: 'playwright-attempt-0001'
  };

  const anonymous = await request.post('/api/revenue/checkout', { data: payload });
  expect(anonymous.status()).toBe(401);
  await expect(anonymous.json()).resolves.toEqual(expect.objectContaining({ error: 'unauthorized' }));

  const wrongScope = await request.post('/api/revenue/checkout', {
    headers: {
      'x-api-key': 'playwright-scoped-key',
      'content-type': 'application/json'
    },
    data: payload
  });
  expect(wrongScope.status()).toBe(403);
  await expect(wrongScope.json()).resolves.toEqual(expect.objectContaining({
    error: 'workspace_forbidden',
    workspace_id: workspaceId
  }));

  const authorized = await request.post('/api/revenue/checkout', {
    headers: creatorHeaders,
    data: payload
  });
  expect(authorized.status()).toBe(503);
  await expect(authorized.json()).resolves.toEqual({ error: 'stripe_checkout_unconfigured' });
});
