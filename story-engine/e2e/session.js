import { expect } from '@playwright/test';

export const ADMIN_BOOTSTRAP_KEY = process.env.PLAYWRIGHT_API_KEY || 'playwright-test-key';
export const CREATOR_BOOTSTRAP_KEY = process.env.PLAYWRIGHT_SCOPED_API_KEY || 'playwright-scoped-key';

export async function establishBrowserSession(page, bootstrapKey = ADMIN_BOOTSTRAP_KEY) {
  const response = await page.context().request.post('/api/auth/session', {
    headers: {
      'x-api-key': bootstrapKey,
      'Content-Type': 'application/json'
    },
    data: {}
  });

  expect([200, 201]).toContain(response.status());
  const payload = await response.json();
  expect(payload.authenticated).toBe(true);
  expect(payload.session?.session_id).toMatch(/^session_/);
  return payload.session;
}
