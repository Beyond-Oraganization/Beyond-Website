import { chromium, expect, test } from '@playwright/test'
import { connected, resetBot } from './helpers.ts'

const APP = 'http://localhost:4300/Beyond-Website/app/'

test.describe('installing', () => {
  test.skip(({ isMobile }) => isMobile, 'runs once, in the desktop project')

  /**
   * Chrome's own verdict. Two things matter, both found while planning: Playwright's default headless shell
   * reports "no errors" even for a page without a manifest, so this uses the full Chromium; and a normal test
   * context counts as incognito, so this uses a persistent profile.
   */
  test('Chromium finds no installability errors, and the app id is its folder', async () => {
    const context = await chromium.launchPersistentContext('', { channel: 'chromium', viewport: { width: 1280, height: 900 } })
    try {
      const page = context.pages()[0] ?? (await context.newPage())
      await page.goto(APP)
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
      const cdp = await context.newCDPSession(page)
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
      expect(installabilityErrors).toEqual([])
      const ids = (await cdp.send('Page.getAppId')) as { appId?: string; recommendedId?: string }
      expect(ids.appId).toBe(`${APP}`)
      expect(ids.recommendedId).toBe('/Beyond-Website/app/')
      const { errors, data } = (await cdp.send('Page.getAppManifest')) as { errors: unknown[]; data?: string }
      expect(errors).toEqual([])
      const manifest = JSON.parse(data ?? '{}')
      expect(manifest).toMatchObject({ id: '/Beyond-Website/app/', name: 'Beyond Bot', short_name: 'Beyond Bot', display: 'standalone', start_url: './#/', scope: './', theme_color: '#003049' })
      expect(manifest.shortcuts.map((s: { name: string }) => s.name)).toEqual(['Session', 'Trading', 'Markets', 'Backtest'])
      expect(manifest.screenshots.filter((s: { form_factor: string }) => s.form_factor === 'wide').length).toBeGreaterThan(0)
      expect(manifest.screenshots.filter((s: { form_factor: string }) => s.form_factor === 'narrow').length).toBeGreaterThan(0)
    } finally {
      await context.close()
    }
  })

  test('starts offline from the service worker, with the last session', async ({ page, context }) => {
    await resetBot()
    await connected(page)
    await page.goto('#/')
    await expect(page.getByText('Equity', { exact: true })).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('link', { name: 'Beyond Bot, Session' })).toBeVisible()
    await expect(page.getByText('Offline: showing the bot as this device last saw it.')).toBeVisible()
    await expect(page.getByText('Equity', { exact: true })).toBeVisible()
    await context.setOffline(false)
  })
})
