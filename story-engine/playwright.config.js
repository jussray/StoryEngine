import { defineConfig, devices } from '@playwright/test';

// Redteam rule: AI agent claims are not release evidence.
// Every spec in this config must pass before a PR merges.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'playwright-report/results.json' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:3000/guardrails',
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
    env: {
      ...process.env,
      PORT: '3000',
      NODE_ENV: 'test',
      API_KEY: process.env.API_KEY || 'playwright-test-key',
      L99_API_KEYS_JSON: process.env.L99_API_KEYS_JSON || JSON.stringify([
        { key: 'playwright-test-key', role: 'administrator', workspace_id: 'pw-workspace-001' },
        { key: 'playwright-creator-key', role: 'creator', workspace_id: 'pw-workspace-001' }
      ]),
      RUNTIME_SCAN_INTERVAL_MS: '3600000',
      RUNTIME_DRAIN_INTERVAL_MS: '3600000',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
      RESEND_API_KEY: process.env.RESEND_API_KEY || ''
    }
  }
});
