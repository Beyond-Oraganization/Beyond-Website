import type { Signal, TickOutcome, TickReport } from './api/types.ts'

/** A signal as the console writes it: "open buy (50% of balance)", "close newest position", "none". */
export function signalWords(signal: Signal | null | undefined): string {
  if (!signal) return 'none'
  if (signal.action === 'Open') return `open ${signal.side.toLowerCase()} (${Math.round(signal.balanceShare * 100)}% of balance)`
  if (signal.action === 'CloseNewest') return 'close newest position'
  return 'none'
}

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
