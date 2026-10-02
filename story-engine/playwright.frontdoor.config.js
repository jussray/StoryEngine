import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './cloudflare-frontdoor/proof',
  timeout: 45_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/frontdoor', open: 'never' }], ...(process.env.CI ? [['github']] : [])],
  outputDir: 'test-results/frontdoor',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx --no-install wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port 8787',
    // Any response at root means the Worker booted. The tests must prove the
    // upstream outcome; waiting for health would hide a broken origin at startup.
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: false,
    timeout: 60_000
  }
});
