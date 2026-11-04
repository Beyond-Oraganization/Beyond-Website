import { z } from 'zod'
import type { CommandResult, SessionSnapshot } from './types.ts'
import { parsed, unreadable, type Parsed } from './parse/blocks.ts'

// The CSP allows no eval. Without this, zod probes for it with `new Function('')` when it builds an object
// schema, which the browser reports as a CSP violation even though zod catches the error.
z.config({ jitless: true })

const num = z.number()
const numOrNull = z.number().nullable()
const str = z.string()
const strOrNull = z.string().nullable()
const market = z.object({ symbol: str, interval: str })
const signal = z.object({ action: str, side: str, balanceShare: num })
const insight = z.object({ signal, reason: str, values: z.array(z.object({ name: str, value: num })) })
const candle = z.object({ openTime: str, closeTime: str, open: num, high: num, low: num, close: num, volume: num })
const order = z.object({ orderId: str, symbol: str, quantity: num, price: num, status: str, type: str, side: str, createdAt: str })

const tick = z.object({
  market,
  strategy: str,
  time: str,
  outcome: str,
  candle: candle.nullable(),
  insight: insight.nullable(),
  candlesAdded: num,
  trade: z.object({ market, strategy: str, action: str, order, time: str }).nullable(),
  elapsed: str,
  nextTickAt: str,
  error: strOrNull.optional().default(null),
})

/** What the app needs from `session --json`; extra fields from a newer bot are ignored. */
export const SessionSchema = z.object({
  time: str,
  account: z.object({
    broker: str,
    mode: str,
    accountId: strOrNull,
    balance: numOrNull,
    currency: str,
    equity: numOrNull,
    equityIsComplete: z.boolean(),
    unrealizedProfit: numOrNull,
    changeSinceStart: numOrNull,
    changeSinceStartPercent: numOrNull,
    leverage: numOrNull,
    exposure: num,
    updatedAt: strOrNull,
    error: strOrNull,
  }),
  positions: z.array(
    z.object({
      id: str,
      symbol: str,
      side: str,
      quantity: num,
      entryPrice: num,
      currentPrice: numOrNull,
      unrealizedProfit: numOrNull,
      profitCurrency: str,
      inAccountCurrency: z.boolean(),
      isConverted: z.boolean(),
      isPending: z.boolean(),
      openedAt: str,
    }),
  ),
  stats: z.object({
    user: strOrNull,
    startedAt: str,
    uptime: str,
    startBalance: numOrNull,
    tradesOpened: num,
    tradesClosed: num,
    realizedProfit: num,
    wins: num,
    losses: num,
  }),
  strategies: z.array(
    z.object({
      market,
      strategy: str,
      parameters: z.record(z.string(), num),
      startedAt: str,
      ticks: num,
      trades: num,
      lastTick: tick.nullable(),
      lastError: strOrNull,
      lastErrorAt: strOrNull,
      nextTickAt: str,
    }),
  ),
  system: z.object({
    version: str,
    processUptime: str,
    broker: z.object({ isConnected: z.boolean(), connectedSince: strOrNull, lastLatency: strOrNull, lastError: strOrNull }),
    database: z
      .object({ isConnected: z.boolean(), server: str, database: str, schemaVersion: num, serverVersion: strOrNull, latency: str, error: strOrNull })
      .nullable(),
    databaseCheckedAt: strOrNull,
    markets: z.array(z.object({ market, candles: num, newestOpenTime: strOrNull, age: strOrNull })),
    managedMemoryBytes: num,
    workingSetBytes: num,
    logPath: strOrNull,
  }),
})

/** The snapshot from a `session --json` answer, checked; null fields from a broker that never answered are fine. */
export function parseSession(result: CommandResult): Parsed<SessionSnapshot> {
  const checked = SessionSchema.safeParse(result.json)
  if (!checked.success) return unreadable(`The session snapshot has an unexpected shape: ${checked.error.issues[0]?.path.join('.') ?? ''}`)
  return parsed(checked.data as unknown as SessionSnapshot)
}

/**
 * The bot cannot build its session view when two or more markets are loaded (Session/SystemProbe.cs sorts
 * MarketId, which has no ordering). Recognised so the app can explain it instead of showing a bare error.
 */
export const isOrderingBug = (message: string | null | undefined) => /Failed to compare two elements in the array/i.test(message ?? '')
