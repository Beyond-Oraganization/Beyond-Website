import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBot, type MockBot } from '../../mock-bot/bot.mjs'
import { queryClient } from '../api/bot.ts'
import type { CommandResult } from '../api/types.ts'
import { deviceAnswer } from '../backtest/fixtures.ts'
import { EngineContext } from '../engine/context.ts'
import type { Engine } from '../engine/engine.ts'
import type { CandleColumns, EngineAnswer, EngineRequest } from '../engine/types.ts'
import { useConnections } from '../state/connections.ts'
import { useSettings } from '../state/settings.ts'
import Backtest from './Backtest.tsx'

// TradingView's chart draws on a canvas, which jsdom lacks; the balance chart is the library's, tested by its users.
vi.mock('../components/Chart.tsx', () => ({ Chart: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }))

/**
 * The Backtest screen against the mock bot (which answers `candles export` and `kelly` as bot 2.1.0 does) and a fake
 * engine that records what it was asked: the real engine is the bot's own code, tested there, and end to end.
 */
const BOT_URL = 'https://bot.test:8443'
const KEY = 'k'.repeat(40)

let bot: MockBot
let overrides: [prefix: string, respond: () => Response][] = []
let asked: { request: EngineRequest; candles: CandleColumns }[] = []
let engineAnswer: EngineAnswer = deviceAnswer()

const server = setupServer(
  http.get('*/engine/version.json', () => HttpResponse.json({ version: '2.1.0', commit: 'test' })),
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    const line = args.join(' ')
    const override = overrides.find(([prefix]) => line.startsWith(prefix))
    if (override) return override[1]()
    const result = await bot.run(args)
    return HttpResponse.json({ command: line, elapsedMs: 7, ...result, json: result.json ?? null, ok: result.exitCode === 0 } satisfies CommandResult)
  }),
)

const answer = (partial: Partial<CommandResult>) =>
  HttpResponse.json({ command: 'x', exitCode: 0, ok: true, elapsedMs: 5, output: '', blocks: [], error: null, json: null, ...partial } satisfies CommandResult)

const engine: Engine = {
  async backtest(request, candles) {
    asked.push({ request, candles })
    return engineAnswer
  },
}

let n = 0
function show() {
  const id = `backtest-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Test bot', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: KEY } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EngineContext.Provider value={() => engine}>
        <MemoryRouter>
          <Backtest />
        </MemoryRouter>
      </EngineContext.Provider>
    </QueryClientProvider>,
  )
}

const run = async () => {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Run the backtest' }))
  return user
}

beforeAll(() => server.listen())
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
  asked = []
  engineAnswer = deviceAnswer()
  useSettings.setState({ openPanels: {} })
})
afterEach(() => {
  cleanup()
  bot.stop()
  overrides = []
  queryClient.clear()
})
afterAll(() => server.close())

describe('Backtest', () => {
  it('copies the bot’s candles to this device and backtests them here, with a thousand Monte Carlo paths', async () => {
    show()
    await run()

    expect(await screen.findByRole('heading', { name: 'Monte Carlo' })).toBeInTheDocument()
    const { request, candles } = asked[0]!
    expect(request).toMatchObject({ strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', kelly: null, monteCarlo: { paths: 1000 } })
    expect(candles.time.length).toBeGreaterThan(1000)
    expect(candles.close.length).toBe(candles.time.length)
  })

  it('heads the report with four figures and keeps the others in a table that starts closed', async () => {
    show()
    await run()

    for (const label of ['Profit / loss', 'Final balance', 'Win rate', 'Max drawdown']) expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
    expect(screen.getByText('All figures').closest('details')).not.toHaveAttribute('open')
  })

  it('says how many paths ended above the starting balance, under the chart', async () => {
    show()
    await run()

    const section = (await screen.findByRole('heading', { name: 'Monte Carlo' })).closest('section') as HTMLElement
    expect(within(section).getByText('66.7%')).toBeInTheDocument()
    expect(within(section).getByText(/of 3 paths ended above the starting balance/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /3 simulated balance paths of 2 trades/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Returns of 2 trades: 1 lost, 1 won/ })).toBeInTheDocument()
  })

  it('keeps the run on this device, with where its paths ended', async () => {
    show()
    await run()

    const saved = (await screen.findByRole('table', { name: 'Saved backtests' })) as HTMLElement
    expect(within(saved).getByText('66.7%')).toBeInTheDocument()
  })

  it('with Kelly sizing, sizes by the Kelly the bot would trade with', async () => {
    const kelly = { estimate: deviceAnswer().kelly, shareOfKelly: 100, backtestId: 7, backtestedAt: '2026-11-08T12:00:00Z', from: '2019-01-02T00:00:00Z', to: '2026-11-08T12:00:00Z' }
    overrides.push(['kelly ', () => answer({ json: { method: 'Kelly', value: 25, kelly } })])
    show()
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Position sizing'), 'kelly')
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    expect(asked[0]?.request.kelly).toMatchObject({ backtestId: 7, shareOfKelly: 100 })
    expect(asked[0]?.request.sizing).toMatch(/^kelly/)
  })

  it('shows the engine’s message for a request it refuses', async () => {
    engineAnswer = { ok: false, engine: '2.1.0', error: { message: "drcs has no parameter speed. Parameters: depth, deviation, moving-count." } }
    show()
    await run()

    expect(await screen.findByText(/drcs has no parameter speed/)).toBeInTheDocument()
  })

  it('tells an older bot, which cannot hand out its candles, from a failure', async () => {
    overrides.push(['candles export', () => answer({ exitCode: 2, ok: false, error: { message: "Unknown command 'export'.", hint: 'Run the command with --help.' } })])
    show()
    await run()

    expect(await screen.findByText(/need bot 2\.1\.0 or later/)).toBeInTheDocument()
    expect(asked).toEqual([])
  })
})
