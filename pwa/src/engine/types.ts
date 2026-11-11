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
  /** For `simulate`: how the alternative price histories are made. Every worker of one run gets the same seed. */
  scenarios?: { method: PathMethod; seed: number } | null
}

/** How a Monte Carlo makes its alternative price histories (the bot's Core/Backtesting/PricePaths.cs). */
export type PathMethod = 'Bootstrap' | 'BrownianMotion'

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

/**
 * One scenario's backtest (the real history's is scenario -1): its figures and its balance at 51 evenly spaced times
 * from the window's start to its end, the last being the final balance.
 */
export type ScenarioResult = {
  scenario: number
  finalBalance: number
  returnPercent: number
  /** Zero or negative. */
  maxDrawdownPercent: number
  trades: number
  winRate: number
  points: number[]
}

/** The closes of one scenario's path at the real answer's `priceTimes`. */
export type ScenarioPrices = { scenario: number; closes: number[] }

/** What one `simulate` call backtested: its share of the scenario numbers. */
export type DeviceScenarios = {
  ok: true
  engine: string
  method: PathMethod
  seed: number
  /** The bootstrap's mean block length, in candles; null for Brownian motion. */
  meanBlockLength: number | null
  /** Brownian motion's mean log return per candle; null for the bootstrap. */
  drift: number | null
  /** Brownian motion's spread of the log returns per candle; null for the bootstrap. */
  volatility: number | null
  results: ScenarioResult[]
  /** Scenarios 0 to 19 only, for the price-paths chart. */
  prices: ScenarioPrices[]
  computedMs: number
}

/** At `percentile` %, each column sorted on its own (a row is not one scenario); drawdowns are zero or negative. */
export type ScenarioPercentile = { percentile: number; finalBalance: number; returnPercent: number; maxDrawdownPercent: number }

export type ScenarioSummary = {
  scenarios: number
  initialBalance: number
  endedAboveStart: number
  endedAboveStartPercent: number
  meanFinal: number
  medianFinal: number
  percentiles: ScenarioPercentile[]
  /** The share of scenarios whose final balance is below the real history's. */
  realBeatPercent: number
  /** The average balance over the scenarios at each of the 51 times. */
  meanPath: number[]
}

export type SummaryRequest = { initialBalance: number; real: ScenarioResult; results: ScenarioResult[] }

export type DeviceSummary = { ok: true; engine: string; summary: ScenarioSummary }

export type DeviceBacktest = {
  ok: true
  /** The engine’s version, e.g. "2.2.0". */
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
  /** The real history scored as the scenarios are, for ranking it among them. */
  realScenario: ScenarioResult
  /** The 51 times of every scenario's `points`. */
  pointTimes: Iso[]
  /** The candles the price-paths chart draws (at most 300), and the real closes at them. */
  priceTimes: Iso[]
  prices: number[]
  computedMs: number
}

export type EngineFailure = { ok: false; engine: string; error: { message: string } }

export type EngineAnswer = DeviceBacktest | EngineFailure

export type SimulateAnswer = DeviceScenarios | EngineFailure

export type SummaryAnswer = DeviceSummary | EngineFailure
