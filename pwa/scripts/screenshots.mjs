// Makes the manifest's screenshots (Chrome's richer install dialog) from the running app and the mock bot:
// phone 780×1688 (390×844 at 2×), computer 1600×1000 (1280×800 at 1.25×). Writes public/screenshots/.
//   npm run screenshots   (then npm run build)
// The page.evaluate callbacks run in the browser.
/* global document, window */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { DEFAULT_KEY, startServer } from '../mock-bot/server.mjs'

const out = fileURLToPath(new URL('../public/screenshots/', import.meta.url))
await mkdir(out, { recursive: true })
const mock = await startServer({ port: 8471, botOptions: { start: Date.UTC(2026, 10, 4, 9, 42), seed: 11, addDelayMs: 300 } })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5179', '--strictPort'], { stdio: 'ignore' })
await new Promise((resolve) => setTimeout(resolve, 2500))

const browser = await chromium.launch()
try {
  async function connect(page) {
    await page.goto('http://localhost:5179/#/connect')
    const skip = page.getByRole('button', { name: 'Continue in the browser' })
    if (await skip.count()) await skip.click()
    await page.getByLabel('Address').fill(`http://127.0.0.1:${mock.port}`)
    await page.getByLabel('API key').fill(DEFAULT_KEY)
    await page.getByLabel('Name (optional)').fill('Gold VM')
    await page.getByLabel('Without').check()
    await page.getByRole('button', { name: 'Check and connect' }).click()
    await page.getByText('Connected', { exact: true }).first().waitFor()
  }
  const shoot = async (page, route, file, settle = 1800, before) => {
    await page.goto(`http://localhost:5179/#${route}`)
    await page.waitForTimeout(settle)
    if (before) await before(page)
    await page.evaluate(() => document.querySelectorAll('.toasts').forEach((t) => t.remove()))
    await page.screenshot({ path: `${out}${file}`, fullPage: false })
    console.log(`✓ public/screenshots/${file}`)
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const p = await phone.newPage()
  await connect(p)
  await shoot(p, '/', 'session-narrow.png')
  await shoot(p, '/trading', 'trading-narrow.png')
  await shoot(p, '/backtest', 'backtest-narrow.png', 1800, async (page) => {
    await page.getByRole('button', { name: 'Run the backtest' }).click()
    await page.getByRole('button', { name: 'Draw the balance over time' }).click()
    await page.getByRole('img', { name: /^Balance from/ }).waitFor({ timeout: 30000 })
    await page.locator('.chart').scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 160))
    await page.waitForTimeout(600)
  })

  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.25, reducedMotion: 'reduce' })
  const w = await wide.newPage()
  await connect(w)
  await shoot(w, '/', 'session-wide.png')
  await shoot(w, '/markets/XAUUSD/1h', 'market-wide.png', 3000, async (page) => {
    await page.locator('.chart').scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -120))
  })
} finally {
  await browser.close()
  vite.kill()
  await mock.close()
}
