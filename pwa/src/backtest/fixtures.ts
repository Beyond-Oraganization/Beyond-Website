import type { DeviceBacktest, DeviceScenarios, DeviceSummary, DeviceTrade, ScenarioResult } from '../engine/types.ts'

/** Test data: engine answers as the bot's BacktestEngine.cs writes them. */

const trade = (ret: number, overlapped = false): DeviceTrade => ({
  side: 'Buy', openedAt: '2025-01-06T00:00:00Z', closedAt: '2025-01-06T01:00:00Z', entryPrice: 100, exitPrice: 100 * (1 + ret),
  quantity: 5, profitLoss: 500 * ret, return: ret, balanceAfter: 1000, overlapped,
})

const START = Date.parse('2025-01-06T00:00:00Z')
const HOUR = 3_600_000
/** The 51 times of the balance paths: two hours apart. */
const POINT_TIMES = Array.from({ length: 51 }, (_, point) => new Date(START + point * 2 * HOUR).toISOString())
const rising = (from: number, to: number) => Array.from({ length: 51 }, (_, point) => from + ((to - from) * point) / 50)

/** A scenario that ends at `final`, its balance rising (or falling) evenly to it. */
export const scenarioResult = (scenario: number, final: number): ScenarioResult => ({
  scenario, finalBalance: final, returnPercent: (final - 1000) / 10, maxDrawdownPercent: final < 1000 ? (final - 1000) / 10 : -0.5, trades: 2, winRate: 50, points: rising(1000, final),
})

/** An engine answer as BacktestEngine.cs writes it: two trades, the second closed on the first's candle. */
export function deviceAnswer(overrides: Partial<DeviceBacktest> = {}): DeviceBacktest {
  return {
    ok: true, engine: '2.2.0', strategy: 'drcs', market: { symbol: 'XAUUSD', interval: '1h' },
    setup: 'depth=23 deviation=1 moving-count=2, rules: open long on cross up lower 1; close long on cross down lower 1',
    parameters: { depth: 23, deviation: 1, 'moving-count': 2 }, rules: ['open long on cross up lower 1', 'close long on cross down lower 1'],
    start: '2025-01-06T00:00:00Z', end: '2025-01-10T04:00:00Z', candles: 100,
    sizing: { method: 'Percent', value: 50, kelly: null },
    kelly: { trades: 2, wins: 1, losses: 1, averageWin: 0.02, averageLoss: 0.01, winProbability: 0.5, lossProbability: 0.5, payoffRatio: 2, percent: 25, whyUnusable: 'only 2 closed trades (it needs at least 20)' },
    initialBalance: 1000, finalBalance: 1004.95, profitLoss: 4.95, returnPercent: 0.495, closedTrades: 2, won: 1, lost: 1, winRate: 50,
    averagePerTrade: 2.475, bestTrade: 10, bestTradePercent: 1, maxDrawdown: -5.05, maxDrawdownPercent: -0.5, stillOpen: 0,
    equityCurve: [{ time: '2025-01-06T05:00:00Z', balance: 1010 }, { time: '2025-01-06T05:00:00Z', balance: 1004.95 }],
    trades: [trade(0.02), trade(-0.01, true)],
    realScenario: scenarioResult(-1, 1004.95),
    pointTimes: POINT_TIMES,
    priceTimes: POINT_TIMES.slice(0, 3),
    prices: [2000, 2010, 2005],
    computedMs: 12,
    ...overrides,
  }
}

/** Three scenarios by bootstrap: two ended above the start of 1,000. */
export function scenariosAnswer(overrides: Partial<DeviceScenarios> = {}): DeviceScenarios {
  return {
    ok: true, engine: '2.2.0', method: 'Bootstrap', seed: 7, meanBlockLength: 4.6, drift: null, volatility: null,
    results: [scenarioResult(0, 1020.1), scenarioResult(1, 1004.9), scenarioResult(2, 994.98)],
    prices: [{ scenario: 0, closes: [2000, 2020, 2030] }, { scenario: 1, closes: [2000, 1990, 1985] }, { scenario: 2, closes: [2000, 2001, 1970] }],
    computedMs: 30,
    ...overrides,
  }
}

/** The summary of {@link scenariosAnswer}, as the engine sums it up: the real history beat one of three. */
export function summaryAnswer(): DeviceSummary {
  return {
    ok: true, engine: '2.2.0',
    summary: {
      scenarios: 3, initialBalance: 1000, endedAboveStart: 2, endedAboveStartPercent: 66.66666666666667, meanFinal: 1006.66, medianFinal: 1004.9,
      percentiles: [5, 25, 50, 75, 95].map((percentile) => ({ percentile, finalBalance: 1000, returnPercent: 0, maxDrawdownPercent: -1 })),
      realBeatPercent: 66.66666666666667, meanPath: rising(1000, 1006.66),
    },
  }
}
