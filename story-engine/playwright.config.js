import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure'
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
        {
          key: 'playwright-test-key',
          actor_id: 'playwright-admin-human',
          tenant_id: 'playwright',
          role: 'administrator',
          principal_type: 'human',
          workspace_ids: ['*']
        },
        {
          key: 'playwright-scoped-key',
          actor_id: 'playwright-scoped-actor',
          tenant_id: 'playwright',
          role: 'creator',
          principal_type: 'human',
          workspace_ids: ['playwright-allowed-workspace']
        }
      ]),
      SOURCE_CANON_PROVIDER: process.env.SOURCE_CANON_PROVIDER || 'local',
      RUNTIME_SCAN_INTERVAL_MS: '3600000',
      RUNTIME_DRAIN_INTERVAL_MS: '3600000'
    }
  }
});
