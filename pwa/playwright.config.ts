import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests of the built app (../app, run `npm run build` first), served at its real GitHub Pages path,
 * against the mock bot. The bot's address in the tests is http://127.0.0.1:4400.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4300/Beyond-Website/app/', reducedMotion: 'reduce', trace: 'retain-on-failure', serviceWorkers: 'allow' },
  webServer: [
    { command: 'node scripts/serve-app.mjs 4300', url: 'http://localhost:4300/Beyond-Website/app/', reuseExistingServer: !process.env.CI },
    { command: 'node mock-bot/server.mjs --port 4400 --control --quiet --add-delay 2500', url: 'http://127.0.0.1:4400/', reuseExistingServer: !process.env.CI },
  ],
  projects: [
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
})
