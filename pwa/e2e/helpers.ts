import { expect, type Locator, type Page } from '@playwright/test'

export const BOT = 'http://127.0.0.1:4400'
export const KEY = 'mock-bot-key-0123456789abcdef0123456789abcdef'

/** A fresh mock bot: signed in as demo, trading XAUUSD 1h, one open position. */
export async function resetBot(options: Record<string, string> = {}) {
  const query = new URLSearchParams({ addDelayMs: '2500', ...options })
  await fetch(`${BOT}/__mock/reset?${query}`, { method: 'POST' })
}

/** Records Content-Security-Policy violations, to assert there are none. */
export async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __csp: string[] }).__csp = seen
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective}: ${event.blockedURI}`))
  })
}
export const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])

/** Connects the app to the mock bot through the Connect wizard (key kept with the device key, no passphrase). */
export async function connect(page: Page, { key = KEY, url = BOT } = {}) {
  await page.goto('#/connect')
  const skip = page.getByRole('button', { name: 'Continue in the browser' })
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await page.getByLabel('Address').fill(url)
  await page.getByLabel('API key').fill(key)
  await page.getByLabel('Name (optional)').fill('Mock bot')
  await page.getByLabel('Without').check()
  await page.getByRole('button', { name: 'Check and connect' }).click()
}

export async function connected(page: Page) {
  await connect(page)
  await expect(page.getByText('Signed in as').or(page.getByRole('link', { name: 'Open the session' })).first()).toBeVisible()
}

/** The first visible match: tables are drawn twice (a table, and cards on a phone), one of them hidden. */
export const shown = (locator: Locator) => locator.filter({ visible: true }).first()
