import { arrow, fmtCount, fmtElapsed, fmtMoney, fmtPercent, fmtSignedMoney, fmtSignedPercent, fmtTime, tone } from '../format.ts'
import { kellyBasisWords, sizingWords } from '../words.ts'
import { isDeviceRun, type SavedRun } from './runs.ts'

export type Headline = { label: string; value: string; sub?: string; tone?: 'gain' | 'loss' | null }
export type FigureGroup = { title: string; rows: [label: string, value: string][] }

/**
 * A run's numbers as the Backtest page shows them: four headline figures, always on screen, and every figure grouped
 * in a table that starts closed. Runs saved before backtests moved to the device have fewer.
 */
export function figuresOf(run: SavedRun): { headline: Headline[]; groups: FigureGroup[] } {
  if (!isDeviceRun(run)) return legacyFigures(run)
  const r = run.result
  const signedPercent = (fraction: number) => fmtSignedPercent(fraction * 100)
  const kelly = r.kelly.whyUnusable
    ? `not usable: ${r.kelly.whyUnusable}`
    : `${fmtPercent(r.kelly.percent)} of the balance (win rate ${fmtPercent(r.kelly.winProbability * 100, 1)}, payoff ${r.kelly.payoffRatio?.toFixed(2) ?? '–'})`
  const basis = kellyBasisWords(r.sizing)

  return {
    headline: [
      { label: 'Profit / loss', value: `${arrow(r.profitLoss)}${fmtSignedMoney(r.profitLoss)}`, sub: fmtSignedPercent(r.returnPercent), tone: tone(r.profitLoss) },
      { label: 'Final balance', value: fmtMoney(r.finalBalance), sub: `from ${fmtMoney(r.initialBalance)}` },
      { label: 'Win rate', value: fmtPercent(r.winRate, 1), sub: `${fmtCount(r.closedTrades)} trades: ${fmtCount(r.won)} won, ${fmtCount(r.lost)} lost` },
      { label: 'Max drawdown', value: fmtPercent(r.maxDrawdownPercent), sub: fmtSignedMoney(r.maxDrawdown), tone: r.maxDrawdown < 0 ? 'loss' : null },
    ],
    groups: [
      {
        title: 'Result',
        rows: [
          ['Starting balance', fmtMoney(r.initialBalance)],
          ['Final balance', fmtMoney(r.finalBalance)],
          ['Profit / loss', `${fmtSignedMoney(r.profitLoss)} (${fmtSignedPercent(r.returnPercent)})`],
        ],
      },
      {
        title: 'Trades',
        rows: [
          ['Closed', `${fmtCount(r.closedTrades)}: ${fmtCount(r.won)} won, ${fmtCount(r.lost)} lost`],
          ['Win rate', fmtPercent(r.winRate, 1)],
          ['Average per trade', fmtSignedMoney(r.averagePerTrade)],
          ['Best trade', `${fmtSignedMoney(r.bestTrade)} (${fmtPercent(r.bestTradePercent)} of the balance)`],
          ['Average win', r.kelly.wins ? `${signedPercent(r.kelly.averageWin)} per position` : '–'],
          ['Average loss', r.kelly.losses ? `${signedPercent(-r.kelly.averageLoss)} per position` : '–'],
          ...(r.stillOpen ? ([['Still open', `${fmtCount(r.stillOpen)}, not counted in the balance`]] as [string, string][]) : []),
          ...(r.overlappingTrades ? ([['Overlapping', `${fmtCount(r.overlappingTrades)} of ${fmtCount(r.closedTrades)} trades were open at the same time as another`]] as [string, string][]) : []),
        ],
      },
      { title: 'Risk', rows: [['Max drawdown', `${fmtSignedMoney(r.maxDrawdown)} (${fmtPercent(r.maxDrawdownPercent)})`]] },
      {
        title: 'Sizing',
        rows: [
          ['Sizing', sizingWords(r.sizing)],
          ...(basis ? ([['Kelly from', `the bot’s ${basis}`]] as [string, string][]) : []),
          ['Kelly of this run', kelly],
        ],
      },
      {
        title: 'Run',
        rows: [
          ['Period', `${fmtTime(Date.parse(r.start))} → ${fmtTime(Date.parse(r.end))} UTC`],
          ['Candles', fmtCount(r.candles)],
          ['Parameters', Object.entries(r.parameters).map(([name, value]) => `${name}=${value}`).join(' ')],
          ['Rules, tried in order', r.rules.join('; ')],
          ['Ran on', `this device, engine ${r.engine}, in ${fmtElapsed(r.computedMs)}`],
        ],
      },
    ],
  }
}

function legacyFigures(run: Exclude<SavedRun, { kind: 'device' }>): { headline: Headline[]; groups: FigureGroup[] } {
  const r = run.report
  return {
    headline: [
      { label: 'Profit / loss', value: `${arrow(r.profitLoss)}${fmtSignedMoney(r.profitLoss)}`, sub: fmtSignedPercent(r.returnPercent), tone: tone(r.profitLoss) },
      { label: 'Final balance', value: fmtMoney(r.finalBalance), sub: `from ${fmtMoney(r.initialBalance)}` },
      { label: 'Win rate', value: fmtPercent(r.winRate, 1), sub: `${fmtCount(r.trades)} trades: ${fmtCount(r.won)} won, ${fmtCount(r.lost)} lost` },
      { label: 'Max drawdown', value: fmtPercent(r.maxDrawdownPercent), sub: fmtSignedMoney(r.maxDrawdown), tone: r.maxDrawdown ? 'loss' : null },
    ],
    groups: [
      { title: 'Trades', rows: [['Average per trade', fmtSignedMoney(r.average)], ['Best trade', `${fmtSignedMoney(r.best)} (${fmtPercent(r.bestPercent)})`]] },
      { title: 'Sizing', rows: [['Sizing', r.sizing ?? '50% of the balance per position'], ...(r.kelly ? ([['Kelly', `${r.kelly.value} ${r.kelly.detail}`.trim()]] as [string, string][]) : [])] },
      {
        title: 'Run',
        rows: [
          ['Period', `${fmtTime(r.start)} → ${fmtTime(r.end)} UTC`],
          ['Candles', fmtCount(r.candles)],
          ['Parameters', r.parameters ?? ''],
          ['Rules, tried in order', r.rules.join('; ')],
          ['Ran on', `the bot${r.storedAs ? `, stored as backtest #${r.storedAs}` : ''}, in ${fmtElapsed(r.computedMs)}`],
        ],
      },
    ],
  }
}
