import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { connected, connect, cspViolations, KEY, resetBot, shown, watchCsp } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await resetBot()
  await watchCsp(page)
})

test.afterEach(async ({ page }) => {
  expect(await cspViolations(page)).toEqual([])
})

test('connects, then shows the session', async ({ page }) => {
  await connected(page)
  await page.getByRole('link', { name: 'Open the session' }).click()
  await expect(page.getByText('Equity', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open positions' })).toBeVisible()
  await expect(shown(page.getByText('XAUUSD'))).toBeVisible()
  await expect(shown(page.getByText('DEMO', { exact: true }))).toBeVisible()
})

test('a wrong key is refused at the key field', async ({ page }) => {
  await connect(page, { key: 'z'.repeat(40) })
  await expect(page.getByText('The bot refused this key.')).toBeVisible()
})

test('an unreachable bot gets the checklist, with this page’s origin to allow', async ({ page }) => {
  await connect(page, { url: 'http://127.0.0.1:4999' })
  await expect(shown(page.getByText('The bot cannot be reached'))).toBeVisible()
  await expect(page.getByText(/BEYONDBOT_API_ORIGINS=http:\/\/localhost:4300/).first()).toBeVisible()
})

test('a bot that is signed out says so and offers to sign it in', async ({ page }) => {
  await resetBot({ signedIn: '0' })
  await connected(page)
  await page.goto('#/')
  await expect(page.getByRole('heading', { name: 'The bot is not signed in.' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign the bot in' }).first().click()
  await page.getByLabel('Login', { exact: true }).fill('demo')
  await page.getByLabel('Password', { exact: true }).fill('demo-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Equity', { exact: true })).toBeVisible()
})

test('adds a market: the busy state, a cancel, and Resume', async ({ page }) => {
  await connected(page)
  await page.goto('#/markets')
  await page.getByRole('button', { name: 'Add a market' }).click()
  await page.getByLabel('Symbol').fill('EURPLN')
  await page.getByLabel('1h').check()
  await page.getByRole('button', { name: 'Add and download' }).click()
  await expect(page.getByText('Downloading EURPLN 1h')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Download cancelled')).toBeVisible()
  await page.getByRole('button', { name: /Resume/ }).click()
  await expect(page.getByText('EURPLN 1h is stored')).toBeVisible({ timeout: 20_000 })
  await expect(shown(page.getByRole('link', { name: 'EURPLN 1h', exact: true }))).toBeVisible()
})

test('backtests, draws the balance over time and keeps the run', async ({ page }) => {
  await connected(page)
  await page.goto('#/backtest')
  await page.getByRole('button', { name: 'Run the backtest' }).click()
  await expect(page.getByText('Profit / loss').first()).toBeVisible()
  await page.getByRole('button', { name: 'Draw the balance over time' }).click()
  await expect(page.getByRole('img', { name: /^Balance from/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Saved runs' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show' }).first()).toBeVisible()
})

test('backtests rules of its own, built from the strategy’s syntax, and shows the bot’s message for a band it has not got', async ({ page }) => {
  await connected(page)
  await page.goto('#/backtest')
  const first = page.getByRole('group', { name: 'Rule 1' })
  await first.getByRole('combobox', { name: 'Rule 1: long or short' }).selectOption('short')
  await first.getByRole('combobox', { name: 'Rule 1: up or down' }).selectOption('down')
  await first.getByRole('combobox', { name: 'Rule 1: lower or upper' }).selectOption('upper')
  const second = page.getByRole('group', { name: 'Rule 2' })
  await second.getByRole('combobox', { name: 'Rule 2: long or short' }).selectOption('short')
  await second.getByRole('combobox', { name: 'Rule 2: up or down' }).selectOption('up')
  await second.getByRole('combobox', { name: 'Rule 2: lower or upper' }).selectOption('upper')
  await expect(page.getByText('Your rules', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run the backtest' }).click()
  await expect(page.getByRole('list').filter({ hasText: 'open short on cross down upper 1' }).first()).toBeVisible()
  await first.getByRole('spinbutton').fill('3')
  await page.getByRole('button', { name: 'Run the backtest' }).click()
  await expect(page.getByText(/upper 3 is not a band of the envelope/).first()).toBeVisible()
})

test('stops and starts trading, each after a confirmation', async ({ page }) => {
  await connected(page)
  await page.goto('#/trading')
  await expect(page.getByRole('heading', { name: '1 strategy trading.' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nothing is trading.' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Preview the decision' }).click()
  await expect(page.getByText(/^Right now:/)).toBeVisible()
  await page.getByRole('button', { name: 'Start trading' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start trading' }).click()
  await expect(page.getByRole('heading', { name: '1 strategy trading.' })).toBeVisible()
})

test('places a market order after review, then closes it', async ({ page }) => {
  await connected(page)
  await page.goto('#/orders')
  await page.getByLabel('Symbol', { exact: true }).fill('EURUSD')
  await page.getByLabel('Quantity').fill('1000')
  await page.getByLabel('Sell').check()
  await page.getByRole('button', { name: 'Review the order' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('market sell', { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Place the sell' }).click()
  await expect(page.getByText('Order filled').first()).toBeVisible()
  const rows = page.locator('tbody tr, ul.cards > li').filter({ hasText: 'EURUSD' }).filter({ visible: true })
  await expect(rows).toHaveCount(1)
  await rows.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close position' }).click()
  await expect(rows).toHaveCount(0)
})

test('the console runs a command, refuses a terminal-only one and asks before a destructive one', async ({ page }) => {
  await connected(page)
  await page.goto('#/console')
  const input = page.getByRole('combobox', { name: 'Command' })
  await input.fill('market list')
  await input.press('Enter')
  await expect(page.getByRole('cell', { name: 'XAUUSD' }).first()).toBeVisible()
  await input.fill('ui')
  await input.press('Enter')
  await expect(page.getByText("'ui' only works in a terminal on the server.")).toBeVisible()
  await input.fill('orders clear')
  await input.press('Enter')
  await expect(page.getByRole('dialog').getByText('It changes the bot or the broker.')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await input.fill(`login demo --password=${'x'}`)
  await input.press('Enter')
  await page.getByRole('dialog').getByRole('button', { name: 'Run it' }).click()
  await expect(page.getByText('login demo --password=***').first()).toBeVisible()
  await expect(page.getByText(KEY)).toHaveCount(0)
})

test('the two-markets bot bug is explained, with the broker’s positions instead', async ({ page }) => {
  await resetBot({ orderingBug: '1' })
  await connected(page)
  await page.goto('#/console')
  await page.getByRole('combobox', { name: 'Command' }).fill('indicators show EURUSD 4h')
  await page.getByRole('combobox', { name: 'Command' }).press('Enter')
  await expect(page.getByRole('cell').first()).toBeVisible()
  await page.goto('#/')
  await page.reload()
  await expect(page.getByText('A known bot bug').first()).toBeVisible()
})

for (const theme of ['classic', 'light'] as const) {
  test(`every screen passes axe (${theme} theme)`, async ({ page }) => {
    if (theme === 'light') await page.addInitScript(() => localStorage.setItem('beyondia-theme', 'light'))
    await connected(page)
    for (const route of ['', 'trading', 'markets', 'markets/XAUUSD/1h', 'backtest', 'orders', 'strategies', 'console', 'system', 'settings', 'account', 'connections', 'install', 'connect']) {
      await page.goto(`#/${route}`)
      // The screen being left can stay in the page, hidden, while the next one loads: wait for a visible heading.
      await page.locator('main h1').filter({ visible: true }).first().waitFor()
      await page.waitForTimeout(800)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).exclude('.chart').analyze()
      expect(results.violations.map((v) => `${route || 'session'}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([])
    }
  })
}
