import { defineConfig, devices } from '@playwright/test';

const baseURL = String(process.env.PRODUCTION_ORIGIN || '').trim().replace(/\/+$/, '');

if (!baseURL || !/^https:\/\//i.test(baseURL)) {
  throw new Error('PRODUCTION_ORIGIN must be the canonical HTTPS StoryEngine production origin.');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  forbidOnly: true,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
