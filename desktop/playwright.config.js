import { defineConfig } from '@playwright/test'

/**
 * The desktop app end to end: Electron opening the app's local build (../pwa, `npm run build` first) against the
 * mock bot, with a throwaway data folder. The same servers and ports as the app's own end-to-end tests.
 */
export default defineConfig({
  testDir: 'test',
  testMatch: '*.e2e.js',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  webServer: [
    { command: 'node ../pwa/scripts/serve-app.mjs 4300', url: 'http://localhost:4300/Beyond-Website/app/', reuseExistingServer: !process.env.CI },
    { command: 'node ../pwa/mock-bot/server.mjs --port 4400 --control --quiet', url: 'http://127.0.0.1:4400/', reuseExistingServer: !process.env.CI },
  ],
})
