import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.pw.ts',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3333',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'bun run src/server.ts',
    port: 3333,
    env: {
      PORT: '3333',
      ADMIN_TOKEN: 'test-e2e-token',
    },
    reuseExistingServer: !process.env.CI,
  },
});
