import { test, expect } from '@playwright/test';
import { establishBrowserSession } from './session.js';

test('operator imports provenance-bound metrics and replay stays idempotent', async ({ page }) => {
  await establishBrowserSession(page);

  const created = await page.context().request.post('/api/story', {
    data: { title: 'Business Metrics Playwright Proof', genre: 'nonfiction', pitch: 'proof' }
  });
  expect(created.status()).toBe(201);
  const { workspace_id: workspaceId } = await created.json();
  expect(workspaceId).toBeTruthy();

  await page.goto('/performance_dashboard.html');
  await expect(page.getByRole('heading', { name: 'Business Evidence' })).toBeVisible();

  await page.locator('#metricWorkspace').fill(workspaceId);
  await page.locator('#metricSource').fill('metricool:facebook');
  await page.locator('#metricAccount').fill('playwright-brand');
  await page.locator('#metricPage').fill('playwright-page');
  await page.locator('#metricAudience').fill('');

  const csv = [
    'observed_at,published_at,measurement_window_hours,condition,metric_name,metric_value,unit,content_id',
    '2026-09-01T12:00:00Z,2026-08-31T12:00:00Z,24,context,impressions,0,count,post-1',
    '2026-09-01T12:00:00Z,2026-08-31T12:00:00Z,24,context,clicks,,count,post-1'
  ].join('\n');
  await page.locator('#metricFile').setInputFiles({
    name: 'metrics.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv)
  });

  await page.locator('#importBusiness').click();
  await expect(page.locator('#businessReceipt')).toContainText('2 written, 0 duplicates, 1 missing values');
  await expect(page.locator('#businessSummary')).toContainText('metricool:facebook');
  await expect(page.locator('#businessSummary')).toContainText('playwright-brand');
  await expect(page.locator('#businessSummary')).toContainText('playwright-page');
  await expect(page.locator('#businessRows')).toContainText('impressions');
  await expect(page.locator('#businessRows')).toContainText('clicks');
  await expect(page.locator('#businessRows')).toContainText('Missing');
  await expect(page.locator('#businessRows')).toContainText('metricool:facebook');
  await expect(page.locator('#businessRows')).toContainText('playwright-brand');
  await expect(page.locator('#businessRows')).toContainText('playwright-page');
  await expect(page.locator('#businessRows')).toContainText('Unknown');
  await expect(page.locator('#businessRows')).toContainText('context · 24h');

  await page.locator('#importBusiness').click();
  await expect(page.locator('#businessReceipt')).toContainText('0 written, 2 duplicates, 1 missing values');

  const business = await page.context().request.get(`/api/performance/business/${encodeURIComponent(workspaceId)}`);
  expect(business.status()).toBe(200);
  const payload = await business.json();
  expect(payload.observations).toHaveLength(2);
  expect(payload.metrics).toHaveLength(2);
  for (const summary of payload.metrics) {
    expect(summary.source).toBe('metricool:facebook');
    expect(summary.account_id).toBe('playwright-brand');
    expect(summary.page_id).toBe('playwright-page');
    expect(summary.audience_segment).toBeNull();
    expect(summary.condition).toBe('context');
    expect(summary.measurement_window_hours).toBe(24);
  }
  const impressions = payload.observations.find(item => item.metric_name === 'impressions');
  const clicks = payload.observations.find(item => item.metric_name === 'clicks');
  expect(impressions.metric_value).toBe(0);
  expect(impressions.value_state).toBe('observed');
  expect(clicks.metric_value).toBeNull();
  expect(clicks.value_state).toBe('missing');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('public AI crawler contract is reachable while private APIs remain closed', async ({ request }) => {
  const robotsResponse = await request.get('/robots.txt');
  expect(robotsResponse.status()).toBe(200);
  const robots = await robotsResponse.text();
  expect(robots).toContain('User-agent: OAI-SearchBot');
  expect(robots).toMatch(/User-agent: OAI-SearchBot[\s\S]*?Allow: \/guardrails\$/);
  expect(robots).toMatch(/User-agent: GPTBot[\s\S]*?Disallow: \/(?:\n|$)/);
  expect(robots).toMatch(/User-agent: ClaudeBot[\s\S]*?Disallow: \/(?:\n|$)/);
  expect(robots).toMatch(/User-agent: Google-Extended[\s\S]*?Disallow: \/(?:\n|$)/);

  const llmsResponse = await request.get('/llms.txt');
  expect(llmsResponse.status()).toBe(200);
  const llms = await llmsResponse.text();
  expect(llms).toContain('Canonical source: https://github.com/jussray/StoryEngine');
  expect(llms).toContain('Model-training and bulk dataset collection are denied by default.');

  const crawlersResponse = await request.get('/crawlers.json');
  expect(crawlersResponse.status()).toBe(200);
  const crawlers = await crawlersResponse.json();
  expect(crawlers.schema).toBe('juss/ai-crawler-contract@v1');
  expect(crawlers.policy.search_discovery).toBe('allow-bounded-public-surface');
  expect(crawlers.policy.model_training).toBe('deny-by-default');
  expect(crawlers.authority).toBe('read-only-public-surface');

  const guardrailsResponse = await request.get('/guardrails.json');
  expect(guardrailsResponse.status()).toBe(200);
  const runtimeIdentityResponse = await request.get('/runtime-identity');
  expect(runtimeIdentityResponse.status()).toBe(200);

  const privateApi = await request.get('/api/stories');
  expect(privateApi.status()).toBe(401);
});
