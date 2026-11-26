import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './qa-torture/e2e',
  timeout: 45000,
  retries: 0,
  use: {
    headless: true,
    browserName: 'chromium'
  }
});
