import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../types.ts'
import { parseAccounts } from './accounts.ts'
import { parseStatus } from './status.ts'

const result = (partial: Partial<CommandResult>): CommandResult => ({ command: 'x', exitCode: 0, ok: true, elapsedMs: 1, output: '', blocks: [], error: null, json: null, ...partial })

describe('accounts --json (Cli/Rendering/AccountViews.cs)', () => {
  it('reads each account of the connection, the current one marked', () => {
    const accounts = parseAccounts(result({
      json: [
        { login: 'beyond', broker: 'CTrader', mode: 'Demo', current: false, connected: true, accountId: '47854922', balance: 10890.81, currency: 'EUR', strategies: 1, signedInAt: '2026-11-06T18:00:00Z', error: null },
        { login: 'roman', broker: 'Bybit', mode: 'Live', current: true, connected: false, accountId: null, balance: null, currency: '', strategies: 0, signedInAt: '2026-11-06T18:05:00Z', error: 'Failed to read the wallet: Unauthorized' },
      ],
    }))

    expect(accounts.ok && accounts.value).toEqual([
      { login: 'beyond', broker: 'CTrader', live: false, current: false, connected: true, accountId: '47854922', balance: 10890.81, currency: 'EUR', strategies: 1, signedInAt: Date.UTC(2026, 10, 6, 18), error: null },
      { login: 'roman', broker: 'Bybit', live: true, current: true, connected: false, accountId: null, balance: null, currency: '', strategies: 0, signedInAt: Date.UTC(2026, 10, 6, 18, 5), error: 'Failed to read the wallet: Unauthorized' },
    ])
  })

  it('an empty connection has no accounts', () => {
    expect(parseAccounts(result({ json: [] }))).toEqual({ ok: true, value: [] })
  })

  it('an answer that is not the list is unreadable', () => {
    expect(parseAccounts(result({ json: null })).ok).toBe(false)
  })
})

describe('status with several accounts on the connection', () => {
  it('reads the current account’s login without the note about the others', () => {
    const status = parseStatus(result({
      blocks: [{ type: 'section', title: 'Status', blocks: [{ type: 'grid', rows: [['Version', '2.0.0, up 5m'], ['User', 'beyond (+1 more on this connection: accounts)'], ['Trading', '1 strategy session(s)']] }] }],
    }))

    expect(status.ok && status.value.user).toBe('beyond')
  })
})
