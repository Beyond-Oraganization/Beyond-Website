import type { Signal, TickOutcome, TickReport } from './api/types.ts'

const POSITION_SIDE: Record<string, string> = { Buy: 'long', Sell: 'short' }

/** A signal as the console writes it (Strategies/Signal.cs): "open long (50% of balance)", "close short", "none". */
export function signalWords(signal: Signal | null | undefined): string {
  if (!signal) return 'none'
  const side = POSITION_SIDE[signal.side] ?? signal.side.toLowerCase()
  if (signal.action === 'Open') return `open ${side} (${Math.round(signal.balanceShare * 100)}% of balance)`
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
