import type { StrategyInput } from '../api/commands.ts'
import type { BacktestReport } from '../api/parse/strategies.ts'
import type { DeviceBacktest, DeviceScenarios, PathMethod, ScenarioSummary } from '../engine/types.ts'

/** A Monte Carlo from before 2.2.0, which resampled the backtest's own trades: runs saved then still hold one. */
export type TradeResampling = { paths: number; endedAboveStartPercent: number }

/**
 * A device backtest as the page keeps it: the engine's answer, with the trades reduced to their returns (what the
 * returns chart needs) and the balance curve to [time in ms, balance] pairs, so saved runs stay small.
 */
export type DeviceResult = Omit<DeviceBacktest, 'trades' | 'equityCurve' | 'realScenario' | 'pointTimes' | 'priceTimes' | 'prices'> & {
  tradeReturns: number[]
  overlappingTrades: number
  curve: [number, number][]
  /** Only in runs saved before 2.2.0. */
  monteCarlo?: TradeResampling | null
}

/** What a Monte Carlo keeps beyond its summary: every scenario's balance path, and the price paths drawn. */
export type ScenarioDetails = {
  /** Every scenario's balance at the 51 times. */
  paths: number[][]
  /** The closes of scenarios 0 to 19 at the price times. */
  prices: number[][]
}

/** A Monte Carlo over alternative price histories, as the page keeps it. */
export type KeptScenarios = {
  method: PathMethod
  seed: number
  meanBlockLength: number | null
  drift: number | null
  volatility: number | null
  summary: ScenarioSummary
  /** The 51 times of the balance paths, in milliseconds. */
  times: number[]
  /** The real history's balance at those times. */
  real: number[]
  /** Every scenario's final balance, in scenario order. */
  finals: number[]
  /** The candles of the price-paths chart (ms), and the real closes at them. */
  priceTimes: number[]
  realPrices: number[]
  /** Null when not loaded: a browser saves only the summary; the desktop app saves these apart from the run. */
  details: ScenarioDetails | null
}

export type DeviceRun = {
  kind: 'device'
  id: string
  at: number
  input: StrategyInput
  balance: number
  from: number | null
  to: number | null
  /** The scenarios asked for (0 for none) and how they were made; absent in runs saved before 2.2.0. */
  scenarios?: number
  method?: PathMethod
  result: DeviceResult
  monteCarlo?: KeptScenarios | null
}

/** A run from before backtests moved to the device: the bot's printed report, and the curve its extra backtests drew. */
export type LegacyRun = { id: string; at: number; input: StrategyInput; balance: number; report: BacktestReport; curve: { time: number; balance: number }[] | null }

export type SavedRun = DeviceRun | LegacyRun

export const isDeviceRun = (run: SavedRun): run is DeviceRun => 'kind' in run && run.kind === 'device'

export const METHOD_NAMES: Record<PathMethod, string> = { Bootstrap: 'bootstrap', BrownianMotion: 'Brownian motion' }

/** The engine's answer as the page keeps it. */
export function keep(answer: DeviceBacktest): DeviceResult {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { trades, equityCurve, realScenario, pointTimes, priceTimes, prices, ...rest } = answer
  return {
    ...rest,
    tradeReturns: trades.map((trade) => trade.return),
    overlappingTrades: trades.filter((trade) => trade.overlapped).length,
    curve: equityCurve.map((point) => [Date.parse(point.time), point.balance]),
  }
}

/** The Monte Carlo as the page keeps it: the real backtest's answer, the scenarios' and their summary. */
export function keepScenarios(real: DeviceBacktest, scenarios: DeviceScenarios, summary: ScenarioSummary): KeptScenarios {
  return {
    method: scenarios.method,
    seed: scenarios.seed,
    meanBlockLength: scenarios.meanBlockLength,
    drift: scenarios.drift,
    volatility: scenarios.volatility,
    summary,
    times: real.pointTimes.map((time) => Date.parse(time)),
    real: real.realScenario.points,
    finals: scenarios.results.map((result) => result.finalBalance),
    priceTimes: real.priceTimes.map((time) => Date.parse(time)),
    realPrices: real.prices,
    details: { paths: scenarios.results.map((result) => result.points), prices: scenarios.prices.map((path) => path.closes) },
  }
}

/** The ended-above-start share of a run's Monte Carlo, whichever method made it; null without one. */
export function endedAbove(run: SavedRun): { percent: number; of: number; method: string } | null {
  if (!isDeviceRun(run)) return null
  if (run.monteCarlo) return { percent: run.monteCarlo.summary.endedAboveStartPercent, of: run.monteCarlo.summary.scenarios, method: METHOD_NAMES[run.monteCarlo.method] }
  return run.result.monteCarlo ? { percent: run.result.monteCarlo.endedAboveStartPercent, of: run.result.monteCarlo.paths, method: 'trade resampling' } : null
}

/** How much of Kelly a sizing asks for: `kelly` is 100, `kelly:50` is 50; null for the other methods. */
export function kellyShare(sizing: string | undefined): number | null {
  const match = /^\s*kelly\s*(?::\s*([\d.]+))?\s*$/i.exec(sizing ?? '')
  return match ? Number(match[1] ?? 100) : null
}

/**
 * The balance after each closed trade, for a time chart: one point per time, the last balance when several trades
 * closed on the same candle (a time chart needs strictly increasing times).
 */
export function curveByTime(curve: [number, number][]): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = []
  for (const [time, value] of curve) {
    if (points.length && points.at(-1)!.time === time) points[points.length - 1] = { time, value }
    else points.push({ time, value })
  }
  return points
}
