import type { SessionSizing, Signal, TickOutcome, TickReport } from './api/types.ts'
import { fmtMoney, fmtPercent } from './format.ts'

/** A percent as the bot writes it in sentences: at most two decimals, no trailing zeros ("50%", "8.75%"). */
const percent = (value: number | null | undefined) => (value == null ? '–' : `${Number(value.toFixed(2))}%`)

const POSITION_SIDE: Record<string, string> = { Buy: 'long', Sell: 'short' }

/**
 * A signal as the console writes it (Strategies/Signal.cs): "open long", "close short", "none". A bot from before
 * position sizing wrote the share too: "open long (50% of balance)".
 */
export function signalWords(signal: Signal | null | undefined): string {
  if (!signal) return 'none'
  const side = POSITION_SIDE[signal.side] ?? signal.side.toLowerCase()
  if (signal.action === 'Open') return signal.balanceShare != null ? `open ${side} (${Math.round(signal.balanceShare * 100)}% of balance)` : `open ${side}`
  if (signal.action === 'Close') return `close ${side}`
  if (signal.action === 'CloseNewest') return 'close newest position'
  return 'none'
}

/**
 * The price levels a decision compared the candle with ("lower 1 2641.80"), as the bot's tick line shows them. A bot
 * from before rules flagged none and called its one level "band".
 */
export const levelsOf = (values: { name: string; value: number; isLevel?: boolean }[] | null | undefined) =>
  (values ?? []).filter((value) => value.isLevel === true || value.name === 'band')

const OUTCOMES: Record<TickOutcome, string> = {
  Evaluated: 'evaluated',
  Preview: 'preview',
  NoNewCandle: 'no new candle',
  MarketClosed: 'market closed',
  Failed: 'failed',
}
export const outcomeWords = (outcome: TickOutcome | string) => OUTCOMES[outcome as TickOutcome] ?? outcome

/** The last signal of a session, or what its last tick did when it evaluated nothing. */
export function lastSignalWords(tick: TickReport | null | undefined): string {
  if (!tick) return '–'
  return tick.insight ? signalWords(tick.insight.signal) : outcomeWords(tick.outcome)
}

/** "1 trade", "3 trades". */
export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * How a running session sizes its positions, as the bot says it (Cli/Rendering/SizingViews.cs): "25% of the balance per
 * position", "500.00 per position", "Kelly 17.5% of the balance per position". A bot from before sizing sends none.
 */
export function sizingWords(sizing: SessionSizing | null | undefined): string {
  if (!sizing) return '50% of the balance per position'
  if (sizing.method === 'Fixed') return `${fmtMoney(sizing.value)} per position`
  if (sizing.kelly && sizing.kelly.shareOfKelly < 100)
    return `Kelly, ${percent(sizing.kelly.shareOfKelly)} of ${percent(sizing.kelly.estimate.percent)} = ${percent(sizing.value)} of the balance per position`
  if (sizing.kelly) return `Kelly ${percent(sizing.value)} of the balance per position`
  return `${percent(sizing.value)} of the balance per position`
}

/** The backtest a Kelly percent came from: "backtest #7: 400 trades, win rate 45.0%, payoff 2.00"; null for other sizings. */
export function kellyBasisWords(sizing: SessionSizing | null | undefined): string | null {
  const kelly = sizing?.kelly
  if (!kelly) return null
  const payoff = kelly.estimate.payoffRatio != null ? kelly.estimate.payoffRatio.toFixed(2) : '–'
  return `backtest #${kelly.backtestId}: ${kelly.estimate.trades} trades, win rate ${fmtPercent(kelly.estimate.winProbability * 100, 1)}, payoff ${payoff}`
}

/**
 * A sizing as the bot words it, split for a stat tile: the number large, the rest below. "50% of the balance per
 * position" → 50% / of the balance per position; "Kelly, 50% of 17.5% = 8.75% of the balance per position" → 8.75% /
 * Kelly, 50% of 17.5%, of the balance per position. Text in another shape stays whole.
 */
export function splitSizing(text: string): { value: string; sub: string } {
  const match = /^(.*?)\s*((?:of the balance )?per position)$/.exec(text)
  if (!match) return { value: text, sub: '' }
  const [, head = '', tail = ''] = match
  const at = head.lastIndexOf('= ')
  return at >= 0 ? { value: head.slice(at + 2), sub: `${head.slice(0, at).trim()}, ${tail}` } : { value: head, sub: tail }
}
