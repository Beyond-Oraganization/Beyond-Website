import { expect, type Locator, type Page } from '@playwright/test'

export const BOT = 'http://127.0.0.1:4400'
export const KEY = 'mock-bot-key-0123456789abcdef0123456789abcdef'

/**
 * A fresh mock bot: its startup account demo trades XAUUSD 1h with one open position. Like the real bot, a device
 * reaches demo only after signing in to it (demo / demo-password).
 */
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
  await page.getByLabel('Remember me on this device').check()
  await page.getByRole('button', { name: 'Check and connect' }).click()
}

/** Signs this device in to a trading account on the Trading accounts screen. */
export async function signIn(page: Page, login = 'demo', password = 'demo-password') {
  await page.goto('#/account')
  await page.getByLabel('Login', { exact: true }).fill(login)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: `Trading as ${login}.` }).or(page.getByText('Equity', { exact: true })).first()).toBeVisible()
}

/** Connected to the mock bot and signed in to its demo account. */
export async function connected(page: Page) {
  await connect(page)
  await expect(page.getByRole('link', { name: 'Add a trading account' }).first()).toBeVisible()
  await signIn(page)
}

/** The first visible match: tables are drawn twice (a table, and cards on a phone), one of them hidden. */
export const shown = (locator: Locator) => locator.filter({ visible: true }).first()
