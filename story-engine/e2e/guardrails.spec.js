import { test, expect } from '@playwright/test';

test('publishes L99 vision and runtime guardrails', async ({ page }) => {
  await page.goto('/guardrails');
  await expect(page).toHaveTitle('L99 Guardrails');
  await expect(page.locator('html')).toHaveAttribute('data-guardrails', 'active');
  await expect(page.getByTestId('vision-stage')).toContainText('alpha');
  await expect(page.locator('[data-guardrail-id="L99-ISOLATION-001"]')).toBeVisible();
  await expect(page.locator('[data-guardrail-id="L99-REVOCATION-001"]')).toBeVisible();
  await expect(page.locator('[data-guardrail-id="L99-FRONTSTAGE-001"]')).toBeVisible();
  await expect(page.getByTestId('truth-owner')).toContainText('operationalTruth=event-spine');
  await expect(page.getByTestId('authorization-status')).toContainText('semanticSimilarityIsAuthorization=false');
  await expect(page.getByTestId('secret-status')).toContainText('creatorSeesOperatorSecrets=false');
});

test('guardrail snapshot is public-safe and explicit', async ({ request }) => {
  const response = await request.get('/guardrails.json');
  expect(response.ok()).toBe(true);
  const body = await response.text();
  expect(body).not.toMatch(/API_KEY|STRIPE_SECRET|RESEND_API_KEY|Bearer\s+[A-Za-z0-9._-]+/i);
  expect(body).not.toMatch(/workspace_id":"|tenant_id":"|private canon|event payload/i);

  const snapshot = JSON.parse(body);
  expect(snapshot.operationalTruth).toBe('event-spine');
  expect(snapshot.semanticSimilarityIsAuthorization).toBe(false);
  expect(snapshot.revocationPrecedence).toBe('revocation-before-ttl');
  expect(snapshot.creatorSeesOperatorSecrets).toBe(false);
});

test('creator surface is reachable while protected APIs deny anonymous access', async ({ page, request }) => {
  const creator = await page.goto('/story_engine.html');
  expect(creator?.status()).toBe(200);
  await expect(page.locator('body')).not.toContainText(/API_KEY|STRIPE_SECRET|RESEND_API_KEY/i);

  const protectedResponse = await request.get('/api/control-room/overview');
  expect([401, 403, 404]).toContain(protectedResponse.status());
});
