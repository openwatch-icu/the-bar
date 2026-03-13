import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173/bar',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer:
    process.env.CI || process.env.PLAYWRIGHT_BASE_URL
      ? undefined
      : {
          command: 'npm run build:app && npx vite preview --outDir dist-app --port 4173',
          url: 'http://localhost:4173/bar/',
          reuseExistingServer: true,
          timeout: 120000,
        },
})
