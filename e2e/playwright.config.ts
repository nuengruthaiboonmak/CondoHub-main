import { defineConfig } from '@playwright/test';
import { loadDotenv } from '../src/config/dotenv';

loadDotenv('.env.local');

const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const isCI = process.env.CI !== undefined;

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  workers: isCI ? 2 : 3,
  retries: isCI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'Asia/Bangkok',
  },
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
});
