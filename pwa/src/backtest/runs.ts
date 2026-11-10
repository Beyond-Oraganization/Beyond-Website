import type { StrategyInput } from '../api/commands.ts'
import type { BacktestReport } from '../api/parse/strategies.ts'
import type { DeviceBacktest, MonteCarloResult } from '../engine/types.ts'

/** A Monte Carlo as the page keeps it: every path while the run is on screen; only the final balances once saved. */
export type KeptMonteCarlo = Omit<MonteCarloResult, 'pathPoints'> & { pathPoints: number[][] | null; finals: number[] }

/**
 * A device backtest as the page keeps it: the engine's answer, with the trades reduced to their returns (what the
 * returns chart needs) and the balance curve to [time in ms, balance] pairs, so 50 saved runs stay small.
 */
export type DeviceResult = Omit<DeviceBacktest, 'trades' | 'equityCurve' | 'monteCarlo'> & {
  tradeReturns: number[]
  overlappingTrades: number
  curve: [number, number][]
  monteCarlo: KeptMonteCarlo | null
}

export type DeviceRun = {
  kind: 'device'
  id: string
  at: number
  input: StrategyInput
  balance: number
  from: number | null
  to: number | null
  /** The Monte Carlo paths asked for; 0 for none. */
  paths: number
  result: DeviceResult
}

/** A run from before backtests moved to the device: the bot's printed report, and the curve its extra backtests drew. */
export type LegacyRun = { id: string; at: number; input: StrategyInput; balance: number; report: BacktestReport; curve: { time: number; balance: number }[] | null }

export type SavedRun = DeviceRun | LegacyRun

export const isDeviceRun = (run: SavedRun): run is DeviceRun => 'kind' in run && run.kind === 'device'

/** The engine's answer as the page keeps it. */
export function keep(answer: DeviceBacktest): DeviceResult {
  const { trades, equityCurve, monteCarlo, ...rest } = answer
  return {
    ...rest,
    tradeReturns: trades.map((trade) => trade.return),
    overlappingTrades: trades.filter((trade) => trade.overlapped).length,
    curve: equityCurve.map((point) => [Date.parse(point.time), point.balance]),
    monteCarlo: monteCarlo ? { ...monteCarlo, finals: monteCarlo.pathPoints.map((path) => path.at(-1) ?? monteCarlo.initialBalance) } : null,
  }
}

/** A run as it is saved on the device: without the Monte Carlo's paths (a thousand of them per run would fill the storage). */
export function forStorage(run: DeviceRun): DeviceRun {
  return run.result.monteCarlo ? { ...run, result: { ...run.result, monteCarlo: { ...run.result.monteCarlo, pathPoints: null } } } : run
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

/** The backtest's own balance by trade number, 0 being the start: its path among the Monte Carlo's. */
export const pathByTrade = (result: DeviceResult): number[] => [result.initialBalance, ...result.curve.map(([, balance]) => balance)]
