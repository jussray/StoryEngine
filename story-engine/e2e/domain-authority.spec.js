import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const contract = JSON.parse(
  readFileSync(new URL('../config/domain-authority.json', import.meta.url), 'utf8'),
);

test('StoryEngine keeps local proof explicit while production authority is source-bound', async ({ page }) => {
  expect(contract.schemaVersion).toBe(1);
  expect(contract.project).toBe('story-engine');
  expect(contract.localOrigin).toBe('http://127.0.0.1:3000');
  expect(['local-only', 'production']).toContain(contract.mode);

  if (contract.mode === 'local-only') {
    expect(contract.productionOrigin).toBeNull();
  } else {
    expect(contract.mode).toBe('production');
    expect(typeof contract.productionOrigin).toBe('string');
    const productionOrigin = new URL(contract.productionOrigin);
    expect(productionOrigin.protocol).toBe('https:');
    expect(productionOrigin.origin).toBe(contract.productionOrigin);
  }

  const response = await page.goto('/guardrails', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(500);
  expect(new URL(page.url()).origin).toBe(contract.localOrigin);
});
