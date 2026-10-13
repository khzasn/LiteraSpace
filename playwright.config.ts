import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  use: {
    baseURL: 'http://localhost:5173/LiteraSpace/',
    viewport: { width: 390, height: 844 },
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/LiteraSpace/',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
