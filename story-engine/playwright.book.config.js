import { defineConfig, devices } from '@playwright/test';

const runtimeId = `book-${process.pid}-${Date.now()}`;
const expectedHeadSha = process.env.EXPECTED_HEAD_SHA || 'b'.repeat(40);

export default defineConfig({
  testDir: './e2e',
  testMatch: /autonomous_book\.spec\.js/,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3011',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node test/support/bookE2eServer.js',
    url: 'http://127.0.0.1:3011/guardrails',
    reuseExistingServer: false,
    timeout: 45_000,
    env: {
      ...process.env,
      PORT: '3011',
      NODE_ENV: 'test',
      EXPECTED_HEAD_SHA: expectedHeadSha,
      L99_DB_PATH: `/tmp/l99-playwright-${runtimeId}.db`,
      L99_VIDEO_OUTPUT_DIR: `/tmp/l99-playwright-video-${runtimeId}`,
      API_KEY: 'playwright-test-key',
      L99_API_KEYS_JSON: JSON.stringify([
        {
          key: 'playwright-test-key',
          actor_id: 'playwright-admin',
          tenant_id: 'founder-control-room',
          role: 'administrator',
          workspace_ids: ['*']
        },
        {
          key: 'playwright-tenant-creator-key',
          actor_id: 'playwright-book-creator',
          tenant_id: 'playwright',
          role: 'creator',
          workspace_ids: []
        }
      ]),
      SOURCE_CANON_PROVIDER: 'local',
      RUNTIME_SCAN_INTERVAL_MS: '3600000',
      RUNTIME_DRAIN_INTERVAL_MS: '3600000',
      ARTIFACT_PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3011'
    }
  }
});
