import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const contract = JSON.parse(
  readFileSync(new URL('../config/domain-authority.json', import.meta.url), 'utf8'),
);

test('StoryEngine remains explicitly local-only until production is promoted', async ({ page }) => {
  expect(contract.schemaVersion).toBe(1);
  expect(contract.project).toBe('story-engine');
  expect(contract.mode).toBe('local-only');
  expect(contract.productionOrigin).toBeNull();
  expect(contract.localOrigin).toBe('http://127.0.0.1:3000');

  const response = await page.goto('/guardrails', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(500);
  expect(new URL(page.url()).origin).toBe(contract.localOrigin);
});
