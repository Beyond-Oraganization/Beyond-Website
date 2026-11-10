import type { DeviceBacktest, DeviceTrade } from '../engine/types.ts'

/** Test data: engine answers as the bot's BacktestEngine.cs writes them. */

const trade = (ret: number, overlapped = false): DeviceTrade => ({
  side: 'Buy', openedAt: '2025-01-06T00:00:00Z', closedAt: '2025-01-06T01:00:00Z', entryPrice: 100, exitPrice: 100 * (1 + ret),
  quantity: 5, profitLoss: 500 * ret, return: ret, balanceAfter: 1000, overlapped,
})

/** An engine answer as BacktestEngine.cs writes it: two trades, the second closed on the first's candle, and three paths. */
export function deviceAnswer(overrides: Partial<DeviceBacktest> = {}): DeviceBacktest {
  return {
    ok: true, engine: '2.1.0', strategy: 'drcs', market: { symbol: 'XAUUSD', interval: '1h' },
    setup: 'depth=23 deviation=1 moving-count=2, rules: open long on cross up lower 1; close long on cross down lower 1',
    parameters: { depth: 23, deviation: 1, 'moving-count': 2 }, rules: ['open long on cross up lower 1', 'close long on cross down lower 1'],
    start: '2025-01-06T00:00:00Z', end: '2025-03-30T08:00:00Z', candles: 2000,
    sizing: { method: 'Percent', value: 50, kelly: null },
    kelly: { trades: 2, wins: 1, losses: 1, averageWin: 0.02, averageLoss: 0.01, winProbability: 0.5, lossProbability: 0.5, payoffRatio: 2, percent: 25, whyUnusable: 'only 2 closed trades (it needs at least 20)' },
    initialBalance: 1000, finalBalance: 1004.95, profitLoss: 4.95, returnPercent: 0.495, closedTrades: 2, won: 1, lost: 1, winRate: 50,
    averagePerTrade: 2.475, bestTrade: 10, bestTradePercent: 1, maxDrawdown: -5.05, maxDrawdownPercent: -0.5, stillOpen: 0,
    equityCurve: [{ time: '2025-01-06T05:00:00Z', balance: 1010 }, { time: '2025-01-06T05:00:00Z', balance: 1004.95 }],
    trades: [trade(0.02), trade(-0.01, true)],
    monteCarlo: {
      paths: 3, tradesPerPath: 2, seed: 7, initialBalance: 1000, endedAboveStart: 2, endedAboveStartPercent: 66.7, ruined: 0, meanFinal: 1006.6, medianFinal: 1004.95,
      percentiles: [], overlappingTrades: 1, warnings: [], pointTrades: [0, 1, 2], meanPath: [1000, 1003.3, 1006.6],
      pathPoints: [[1000, 1010, 1020.1], [1000, 1010, 1004.95], [1000, 995, 994.98]],
    },
    monteCarloSkipped: null, computedMs: 12,
    ...overrides,
  }
}
