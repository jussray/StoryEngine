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
    '2026-09-01T12:00:00Z,clicks,,count,post-1'
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
  await expect(page.locator('#businessSummary')).toContainText('founders');
  await expect(page.locator('#businessRows')).toContainText('impressions');
  await expect(page.locator('#businessRows')).toContainText('clicks');
  await expect(page.locator('#businessRows')).toContainText('Missing');
  await expect(page.locator('#businessRows')).toContainText('metricool:facebook');
  await expect(page.locator('#businessRows')).toContainText('playwright-brand');
  await expect(page.locator('#businessRows')).toContainText('playwright-page');
  await expect(page.locator('#businessRows')).toContainText('founders');

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
    expect(summary.audience_segment).toBe('founders');
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
