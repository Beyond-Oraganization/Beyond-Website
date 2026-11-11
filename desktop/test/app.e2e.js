import { _electron as electron, expect, test } from '@playwright/test'
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = 'http://localhost:4300/Beyond-Website/app/'
// The mock bot's own test address, key and demo account, as in ../pwa/e2e/helpers.ts.
const BOT = 'http://127.0.0.1:4400'
const KEY = 'mock-bot-key-0123456789abcdef0123456789abcdef'
const desktop = fileURLToPath(new URL('..', import.meta.url))

let data = ''
test.beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'beyond-bot-desktop-'))
})
test.afterEach(() => rmSync(data, { recursive: true, force: true }))

const launch = () => electron.launch({ args: ['.'], cwd: desktop, env: { ...process.env, BEYOND_BOT_APP_URL: APP, BEYOND_BOT_DATA_DIR: data } })

/** The rows of the desktop app's SQLite file, values decoded by Electron's own Node. */
function rows() {
  const read = spawnSync(electronPath, [join(desktop, 'test', 'read-database.js'), join(data, 'beyond-bot.sqlite')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (read.status !== 0) throw new Error(read.stderr)
  return JSON.parse(read.stdout)
}

test('keeps a backtest, every scenario of its Monte Carlo and the candle copy in its SQLite file, and the remembered login, across a restart', async () => {
  let app = await launch()
  let page = await app.firstWindow()
  await expect(page.getByRole('link', { name: 'Backtest' }).first()).toBeAttached()
  expect(await page.evaluate(() => window.beyondBotDesktop?.storage)).toBe('sqlite')

  await page.goto(`${APP}#/connect`)
  const skip = page.getByRole('button', { name: 'Continue in the browser' })
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await page.getByLabel('Address').fill(BOT)
  await page.getByLabel('API key').fill(KEY)
  await page.getByLabel('Name (optional)').fill('Mock bot')
  await page.getByText('Remember me on this device').click()
  await page.getByRole('button', { name: 'Check and connect' }).click()
  await expect(page.getByRole('link', { name: 'Add a trading account' }).first()).toBeVisible()
  await page.goto(`${APP}#/account`)
  await page.getByLabel('Login', { exact: true }).fill('demo')
  await page.getByLabel('Password', { exact: true }).fill('demo-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Equity', { exact: true }).first()).toBeVisible()

  await page.goto(`${APP}#/backtest`)
  await page.getByRole('radio', { name: '100 scenarios' }).check()
  await page.getByRole('button', { name: 'Run the backtest' }).click()
  await expect(page.getByRole('heading', { name: 'Monte Carlo' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: 'Show' })).toHaveCount(1)
  await app.close()

  const stored = rows()
  const run = stored.find((row) => row.store === 'app' && row.key.startsWith('runs:'))
  const details = stored.find((row) => row.store === 'app' && row.key.startsWith('run-details:'))
  expect(run?.value.monteCarlo.summary.scenarios).toBe(100)
  expect(details?.value.paths).toHaveLength(100)
  expect(details?.value.prices).toHaveLength(20)
  expect(stored.some((row) => row.store === 'candles' && row.key.endsWith('|meta'))).toBe(true)
  expect(stored.some((row) => row.store === 'candles' && row.value.close?.typedArray === 'Float64Array')).toBe(true)
  expect(stored.some((row) => row.key === 'device-key')).toBe(false)

  // After a restart the login is remembered, and the saved run comes back with every scenario's path.
  app = await launch()
  page = await app.firstWindow()
  await page.goto(`${APP}#/backtest`)
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(page.getByRole('img', { name: /^The balance over time in 100 alternative price histories/ })).toBeVisible()
  await expect(page.getByText('One alternative history').first()).toBeVisible()
  await expect(page.getByRole('img', { name: /^The real price from .* and 20 alternative histories/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run the backtest' })).toBeEnabled()
  await app.close()
})

test('stays on the app: a link to another site opens in the person’s browser, never in the window that holds the database', async () => {
  const app = await launch()
  const page = await app.firstWindow()
  await expect(page.getByRole('link', { name: 'Backtest' }).first()).toBeAttached()
  // Record what would open in the browser instead of opening it.
  await app.evaluate(({ shell }) => {
    globalThis.openedOutside = []
    shell.openExternal = async (url) => void globalThis.openedOutside.push(url)
  })

  await page.evaluate((url) => {
    location.href = url
  }, `${BOT}/elsewhere`)

  await expect.poll(() => app.evaluate(() => globalThis.openedOutside)).toEqual([`${BOT}/elsewhere`])
  expect(page.url()).toContain('/Beyond-Website/app/')
  await app.close()
})
