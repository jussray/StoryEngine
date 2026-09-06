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
          key: 'playwright-scoped-key',
          actor_id: 'playwright-scoped-actor',
          tenant_id: 'playwright',
          role: 'creator',
          workspace_ids: ['playwright-allowed-workspace']
        },
        {
          key: 'playwright-other-admin-key',
          actor_id: 'playwright-other-admin-actor',
          tenant_id: 'other-internal-service',
          role: 'administrator',
          workspace_ids: ['*']
        },
        {
          key: 'playwright-other-fcr-admin-key',
          actor_id: 'other-fcr-admin',
          tenant_id: 'founder-control-room',
          role: 'administrator',
          workspace_ids: ['*']
        },
        {
          key: 'playwright-admin-key',
          actor_id: 'fcr-storyengine-control-room',
          tenant_id: 'founder-control-room',
          role: 'administrator',
          workspace_ids: ['*']
        }
      ]),
      SOURCE_CANON_PROVIDER: process.env.SOURCE_CANON_PROVIDER || 'local',
      OODA_INTERVAL_MS: '250',
      RUNTIME_SCAN_INTERVAL_MS: '3600000',
      RUNTIME_DRAIN_INTERVAL_MS: '3600000'
    }
  }
});
