import type { KellyEstimate, SessionSizing } from '../api/types.ts'

/**
 * The browser engine's JSON (the bot's Core/Backtesting/BacktestEngine.cs, compiled to WebAssembly): what the app
 * asks for, and what it answers. Field names and meanings are the bot's own.
 */

type Iso = string

/** The candles of one market on this device, as columns: open times in Unix seconds, then prices and volumes. */
export type CandleColumns = { time: Float64Array; open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array; volume: Float64Array }

export type EngineRequest = {
  strategy: string
  symbol: string
  /** Interval code, e.g. "1h". */
  interval: string
  parameters?: Record<string, number>
  /** The rules, in order; none means the strategy's defaults. */
  rules?: string[]
  /** As `--sizing` takes it; the bot's default (half the balance) when left out. */
  sizing?: string
  /** For Kelly sizing: the `kelly` part of the bot's `kelly … --json` answer, so the device sizes as live trading would. */
  kelly?: NonNullable<SessionSizing['kelly']> | null
  balance?: number
  /** UTC, without "Z" or with it; the first candle when left out. */
  from?: Iso | null
  /** UTC; the last candle's close when left out. */
  to?: Iso | null
  monteCarlo?: { paths: number; seed?: number } | null
}

export type EquityPoint = { time: Iso; balance: number }

/** One simulated position from open to close. `return` is the price move in its favour per unit (0.012 is +1.2 %). */
export type DeviceTrade = {
  side: 'Buy' | 'Sell'
  openedAt: Iso
  closedAt: Iso
  entryPrice: number
  exitPrice: number
  quantity: number
  profitLoss: number
  return: number
  balanceAfter: number
  overlapped: boolean
}

/** At `percentile` %, each column sorted on its own (a row is not one path); drawdowns are zero or negative. */
export type MonteCarloPercentile = { percentile: number; finalBalance: number; returnPercent: number; maxDrawdownPercent: number }

export type MonteCarloResult = {
  paths: number
  tradesPerPath: number
  seed: number
  initialBalance: number
  endedAboveStart: number
  endedAboveStartPercent: number
  ruined: number
  meanFinal: number
  medianFinal: number
  percentiles: MonteCarloPercentile[]
  overlappingTrades: number
  warnings: string[]
  /** Trade numbers (0 is the start) at which the mean path and every path are kept: at most 51. */
  pointTrades: number[]
  meanPath: number[]
  /** Every path's balance at each point trade; its last point is its final balance. */
  pathPoints: number[][]
}

export type DeviceBacktest = {
  ok: true
  /** The engine's version, e.g. "2.1.0". */
  engine: string
  strategy: string
  market: { symbol: string; interval: string }
  /** "depth=23 deviation=1 moving-count=2, rules: …", the bot's setup line. */
  setup: string
  parameters: Record<string, number>
  rules: string[]
  start: Iso
  end: Iso
  candles: number
  sizing: SessionSizing
  /** The Kelly criterion over this run's closed trades. */
  kelly: KellyEstimate
  initialBalance: number
  finalBalance: number
  profitLoss: number
  returnPercent: number
  closedTrades: number
  won: number
  lost: number
  winRate: number
  averagePerTrade: number
  bestTrade: number
  bestTradePercent: number
  maxDrawdown: number
  maxDrawdownPercent: number
  stillOpen: number
  equityCurve: EquityPoint[]
  trades: DeviceTrade[]
  monteCarlo: MonteCarloResult | null
  /** Why no Monte Carlo ran although one was asked for (no closed trade). */
  monteCarloSkipped: string | null
  computedMs: number
}

export type EngineFailure = { ok: false; engine: string; error: { message: string } }

export type EngineAnswer = DeviceBacktest | EngineFailure
