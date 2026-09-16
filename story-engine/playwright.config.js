import { defineConfig, devices } from '@playwright/test';

const playwrightRuntimeId = `${process.pid}-${Date.now()}`;
const playwrightExpectedHead = process.env.EXPECTED_HEAD_SHA || 'b'.repeat(40);

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
      EXPECTED_HEAD_SHA: playwrightExpectedHead,
      // Browser proof must never depend on or mutate tracked repository SQLite/WAL
      // state. Production still requires its provider-mounted persistent path.
      L99_DB_PATH: process.env.L99_DB_PATH || `/tmp/l99-playwright-${playwrightRuntimeId}.db`,
      L99_VIDEO_OUTPUT_DIR: process.env.L99_VIDEO_OUTPUT_DIR || `/tmp/l99-playwright-video-${playwrightRuntimeId}`,
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
          key: 'playwright-admin-key',
          actor_id: 'fcr-storyengine-control-room',
          tenant_id: 'founder-control-room',
          role: 'administrator',
          workspace_ids: ['*']
        },
        {
          key: 'playwright-other-admin-key',
          actor_id: 'other-admin',
          tenant_id: 'other-tenant',
          role: 'administrator',
          workspace_ids: ['*']
        },
        {
          key: 'playwright-other-fcr-admin-key',
          actor_id: 'other-fcr-admin',
          tenant_id: 'founder-control-room',
          role: 'administrator',
          workspace_ids: ['*']
        }
      ]),
      SOURCE_CANON_PROVIDER: process.env.SOURCE_CANON_PROVIDER || 'local',
      RUNTIME_SCAN_INTERVAL_MS: '3600000',
      RUNTIME_DRAIN_INTERVAL_MS: '3600000'
    }
  }
});
