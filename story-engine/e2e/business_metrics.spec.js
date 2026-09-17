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
  await page.locator('#metricAudience').fill('founders');

  const csv = [
    'observed_at,metric_name,metric_value,unit,content_id',
    '2026-09-01T12:00:00Z,impressions,0,count,post-1',
    '2026-09-01T12:00:00Z,impressions,25,count,post-2',
    '2026-09-01T12:00:00Z,clicks,,count,post-1'
  ].join('\n');
  await page.locator('#metricFile').setInputFiles({
    name: 'metrics.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv)
  });

  await page.locator('#importBusiness').click();
  await expect(page.locator('#businessReceipt')).toContainText('3 written, 0 duplicates, 1 missing values');
  await expect(page.locator('#businessSummary')).toContainText('metricool:facebook');
  await expect(page.locator('#businessSummary')).toContainText('playwright-brand');
  await expect(page.locator('#businessSummary')).toContainText('playwright-page');
  await expect(page.locator('#businessSummary')).toContainText('post-1');
  await expect(page.locator('#businessSummary')).toContainText('post-2');
  await expect(page.locator('#businessSummary')).toContainText('founders');
  await expect(page.locator('#businessRows')).toContainText('impressions');
  await expect(page.locator('#businessRows')).toContainText('clicks');
  await expect(page.locator('#businessRows')).toContainText('Missing');
  await expect(page.locator('#businessRows')).toContainText('metricool:facebook');
  await expect(page.locator('#businessRows')).toContainText('playwright-brand');
  await expect(page.locator('#businessRows')).toContainText('playwright-page');
  await expect(page.locator('#businessRows')).toContainText('post-1');
  await expect(page.locator('#businessRows')).toContainText('post-2');
  await expect(page.locator('#businessRows')).toContainText('founders');

  await page.locator('#importBusiness').click();
  await expect(page.locator('#businessReceipt')).toContainText('0 written, 3 duplicates, 1 missing values');

  const business = await page.context().request.get(`/api/performance/business/${encodeURIComponent(workspaceId)}`);
  expect(business.status()).toBe(200);
  const payload = await business.json();
  expect(payload.observations).toHaveLength(3);
  expect(payload.metrics).toHaveLength(3);
  for (const summary of payload.metrics) {
    expect(summary.source).toBe('metricool:facebook');
    expect(summary.account_id).toBe('playwright-brand');
    expect(summary.page_id).toBe('playwright-page');
    expect(summary.audience_segment).toBe('founders');
  }
  const impressionSummaries = payload.metrics.filter(item => item.metric_name === 'impressions');
  expect(impressionSummaries).toHaveLength(2);
  expect(impressionSummaries.map(item => item.content_id).sort()).toEqual(['post-1', 'post-2']);

  const postOneImpressions = payload.observations.find(item => item.metric_name === 'impressions' && item.content_id === 'post-1');
  const postTwoImpressions = payload.observations.find(item => item.metric_name === 'impressions' && item.content_id === 'post-2');
  const clicks = payload.observations.find(item => item.metric_name === 'clicks');
  expect(postOneImpressions.metric_value).toBe(0);
  expect(postOneImpressions.value_state).toBe('observed');
  expect(postTwoImpressions.metric_value).toBe(25);
  expect(postTwoImpressions.value_state).toBe('observed');
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
