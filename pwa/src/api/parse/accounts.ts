import type { CommandResult } from '../types.ts'
import { parsed, unreadable, type Parsed } from './blocks.ts'

/** One trading account of this device's connection to the bot. */
export type TradingAccount = {
  login: string
  /** "CTrader" or "Bybit". */
  broker: string
  /** Trades real money. */
  live: boolean
  /** The account commands act on unless a screen picks another. */
  current: boolean
  connected: boolean
  accountId: string | null
  balance: number | null
  currency: string
  /** Running strategies. */
  strategies: number
  signedInAt: number
  /** Why the broker could not be read, when it could not. */
  error: string | null
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** `accounts --json` (Cli/Rendering/AccountViews.cs): this connection's accounts. */
export function parseAccounts(result: CommandResult): Parsed<TradingAccount[]> {
  if (!Array.isArray(result.json)) return unreadable('The answer is not a list of accounts.')
  const accounts: TradingAccount[] = []
  for (const item of result.json as Record<string, unknown>[]) {
    const login = text(item?.login)
    if (!login) return unreadable('An account without a login.')
    accounts.push({
      login,
      broker: text(item.broker) ?? '',
      live: String(item.mode).toLowerCase() === 'live',
      current: item.current === true,
      connected: item.connected === true,
      accountId: text(item.accountId),
      balance: number(item.balance),
      currency: text(item.currency) ?? '',
      strategies: number(item.strategies) ?? 0,
      signedInAt: Date.parse(text(item.signedInAt) ?? '') || 0,
      error: text(item.error),
    })
  }
  return parsed(accounts)
}
