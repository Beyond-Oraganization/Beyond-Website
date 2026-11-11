import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createBot, type MockBot } from '../../mock-bot/bot.mjs'
import { queryClient } from '../api/bot.ts'
import type { CommandResult } from '../api/types.ts'
import { useConnections } from '../state/connections.ts'
import Markets from './Markets.tsx'
import Orders from './Orders.tsx'
import Session from './Session.tsx'
import Strategies from './Strategies.tsx'
import System from './System.tsx'

/**
 * Every screen in the states an answer can take: normal, empty, failed with the bot's hint, signed out (exit
 * code 3), unreachable, a refused key, and an answer the app cannot read (shown as the bot printed it). The
 * network is MSW; the normal answers come from the mock bot, which prints exactly what the real bot prints.
 */
const BOT_URL = 'https://bot.test:8443'
const KEY = 'k'.repeat(40)

let bot: MockBot
let overrides: [prefix: string, respond: () => Response][] = []

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    if (request.headers.get('authorization') !== `Bearer ${KEY}`) return new HttpResponse(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
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
const failed = (exitCode: number, message: string, hint: string | null) => () => answer({ exitCode, ok: false, error: { message, hint } })

let n = 0
function show(element: ReactElement, key = KEY) {
  const id = `test-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Test bot', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: key } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
})
afterEach(() => {
  cleanup()
  bot.stop()
  overrides = []
  queryClient.clear()
})
afterAll(() => server.close())

type Case = { name: string; element: () => ReactElement; command: string; normal: RegExp; empty?: { answer: string; shows: string } }

const SCREENS: Case[] = [
  { name: 'Markets', element: () => <Markets />, command: 'market list', normal: /^XAUUSD 1h$/, empty: { answer: 'No markets yet. Add one with: market add XAUUSD 1h', shows: 'No markets yet.' } },
  { name: 'Orders', element: () => <Orders />, command: 'orders list --broker', normal: /^812345$/, empty: { answer: 'The broker has no open positions or pending orders.', shows: 'Nothing is open at the broker.' } },
  { name: 'Strategies', element: () => <Strategies />, command: 'strategies', normal: /Double Red Cross/ },
  { name: 'System', element: () => <System />, command: 'status', normal: /^2\.2\.0, up / },
]

describe.each(SCREENS)('$name', ({ element, command, normal, empty }) => {
  it('shows the bot’s answer', async () => {
    show(element())
    expect((await screen.findAllByText(normal)).length).toBeGreaterThan(0)
    expect(screen.queryByText('The bot said no')).toBeNull()
  })

  if (empty)
    it('says when there is nothing yet', async () => {
      overrides.push([command, () => answer({ blocks: [{ type: 'text', text: empty.answer }] })])
      show(element())
      expect(await screen.findByText(empty.shows)).toBeInTheDocument()
    })

  it('shows a failure with the bot’s message, its hint and a way out', async () => {
    overrides.push([command, failed(1, 'The database cannot be reached: connection refused.', "Run 'status' to see what is wrong.")])
    show(element())
    const panel = (await screen.findAllByText('The database cannot be reached: connection refused.'))[0]!.closest('.callout') as HTMLElement
    expect(within(panel).getByText("Run 'status' to see what is wrong.")).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Check the system' })).toHaveAttribute('href', '/system')
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says when the bot cannot be reached', async () => {
    overrides.push([command, () => HttpResponse.error()])
    show(element())
    expect((await screen.findAllByText('The bot cannot be reached.')).length).toBeGreaterThan(0)
  })

  it('says when the bot refuses the key', async () => {
    show(element(), 'w'.repeat(40))
    expect((await screen.findAllByText('The bot refused the API key.')).length).toBeGreaterThan(0)
  })

  it('shows an answer it cannot read as the bot printed it', async () => {
    overrides.push([command, () => answer({ blocks: [{ type: 'table', title: null, columns: ['Something', 'New'], rows: [['from a newer bot', '42']] }] })])
    show(element())
    expect((await screen.findAllByText(/^Shown as the bot printed it/)).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('cell', { name: 'from a newer bot' }).length).toBeGreaterThan(0)
  })
})

describe('System, with the database down', () => {
  it('shows the status as degraded, not as a failure (exit code 1 without an error)', async () => {
    bot.stop()
    bot = createBot({ ticking: false, seed: 3, databaseDown: true })
    show(<System />)
    expect((await screen.findAllByText(/^unavailable \(Cannot reach MySQL/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Down').length).toBeGreaterThan(0)
    expect(screen.queryByText('The bot said no')).toBeNull()
  })
})

describe('Session', () => {
  it('shows the account, positions and strategies', async () => {
    show(<Session />)
    expect(await screen.findByText('Equity')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Open positions' })).toBeInTheDocument()
  })

  it('says this device has no trading account (exit code 3) and offers to add one', async () => {
    overrides.push(['session', failed(3, 'You need to log in first.', "Run 'login' (or 'register' to create an account).")])
    show(<Session />)
    expect(await screen.findByRole('heading', { name: 'No trading account yet.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a trading account' })).toHaveAttribute('href', '/account')
  })

  it('explains the bot’s two-markets bug and shows the broker’s positions instead', async () => {
    overrides.push(['session', failed(1, 'Failed to compare two elements in the array.', null)])
    show(<Session />)
    expect((await screen.findAllByText('A known bot bug')).length).toBeGreaterThan(0)
    const positions = await screen.findByRole('table', { name: 'Positions at the broker' })
    expect(within(positions).getByRole('cell', { name: '812345' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Close or cancel in Orders' })).toHaveAttribute('href', '/orders')
  })

  it('shows a snapshot it cannot read as the bot printed it', async () => {
    overrides.push(['session', () => answer({ json: { something: 'else' }, blocks: [{ type: 'grid', rows: [['Equity', 'soon']] }] })])
    show(<Session />)
    expect((await screen.findAllByText(/^Shown as the bot printed it/)).length).toBeGreaterThan(0)
  })
})
