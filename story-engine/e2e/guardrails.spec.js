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

test('control room does not turn missing health evidence into green truth', async ({ page }) => {
  let mode = 'unknown';

  await page.route('**/api/control-room/overview', async (route) => {
    const payload = mode === 'unknown'
      ? {
          generated_at: Date.now(),
          overview: {
            workspaces: 0,
            queue_depth: 0,
            running_dispatches: 0,
            runtime_runs: 0,
            runtime_failures: 0,
            release_gate_blocked_count: 0,
          },
          workspaces: [],
          operator_alerts: [],
          incidents: [],
          pipeline_health: [],
          memory: {},
          operator: { profile: {} },
          story_engine_brain: { active_count: 0, pipeline_stages: [] },
        }
      : {
          generated_at: Date.now(),
          overview: {
            workspaces: 1,
            queue_depth: 0,
            running_dispatches: 0,
            runtime_runs: 2,
            runtime_failures: 0,
            release_gate_blocked_count: 0,
          },
          workspaces: [{
            workspace_id: 'proof-workspace',
            title: 'Proof Workspace',
            chapter_count: 1,
            confidence_score: 90,
            release_gate_status: 'READY',
            runtime_status: 'completed',
            latest_release_attempt: null,
          }],
          operator_alerts: [],
          incidents: [],
          pipeline_health: [],
          memory: {},
          operator: { profile: {} },
          story_engine_brain: { active_count: 0, pipeline_stages: [] },
        };

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.route('**/api/control-room/stream', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/control_room.html');

  const releaseGateCard = page.locator('#stats .card').filter({ hasText: 'Release Gate' });
  const runtimeCard = page.locator('#stats .card').filter({ hasText: 'Runtime' });
  await expect(releaseGateCard.locator('.value')).toHaveText('UNKNOWN');
  await expect(runtimeCard.locator('.value')).toHaveText('Unknown');
  await expect(releaseGateCard.locator('.value')).not.toHaveClass(/green/);
  await expect(runtimeCard.locator('.value')).not.toHaveClass(/green/);

  mode = 'ready';
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(releaseGateCard.locator('.value')).toHaveText('READY');
  await expect(runtimeCard.locator('.value')).toHaveText('Healthy');
  await expect(releaseGateCard.locator('.value')).toHaveClass(/green/);
  await expect(runtimeCard.locator('.value')).toHaveClass(/green/);
});
