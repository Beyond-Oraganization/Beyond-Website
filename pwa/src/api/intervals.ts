import type { IntervalName } from './types.ts'

/** Domain/Interval.cs: the one table of codes and lengths. Codes are case-sensitive ("1m" minute, "1M" month). */
export type IntervalInfo = {
  code: string
  name: IntervalName
  /** The broker's period name, accepted as input too. */
  alias: string | null
  ms: number
  /** cTrader has these candles (Brokers/CTrader/CTraderBroker.cs); `market add` fails for the others. */
  ctrader: boolean
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const INTERVALS: IntervalInfo[] = [
  { code: '1m', name: 'OneMinute', alias: 'M1', ms: MIN, ctrader: true },
  { code: '3m', name: 'ThreeMinutes', alias: 'M3', ms: 3 * MIN, ctrader: true },
  { code: '5m', name: 'FiveMinutes', alias: 'M5', ms: 5 * MIN, ctrader: true },
  { code: '15m', name: 'FifteenMinutes', alias: 'M15', ms: 15 * MIN, ctrader: true },
  { code: '30m', name: 'ThirtyMinutes', alias: 'M30', ms: 30 * MIN, ctrader: true },
  { code: '1h', name: 'OneHour', alias: 'H1', ms: HOUR, ctrader: true },
  { code: '2h', name: 'TwoHours', alias: null, ms: 2 * HOUR, ctrader: false },
  { code: '4h', name: 'FourHours', alias: 'H4', ms: 4 * HOUR, ctrader: true },
  { code: '6h', name: 'SixHours', alias: null, ms: 6 * HOUR, ctrader: false },
  { code: '8h', name: 'EightHours', alias: null, ms: 8 * HOUR, ctrader: false },
  { code: '12h', name: 'TwelveHours', alias: 'H12', ms: 12 * HOUR, ctrader: true },
  { code: '1d', name: 'OneDay', alias: 'D1', ms: DAY, ctrader: true },
  { code: '3d', name: 'ThreeDays', alias: null, ms: 3 * DAY, ctrader: false },
  { code: '1w', name: 'OneWeek', alias: 'W1', ms: 7 * DAY, ctrader: true },
  // Months vary in length; the bot uses 30 days only to schedule ticks.
  { code: '1M', name: 'OneMonth', alias: 'MN1', ms: 30 * DAY, ctrader: true },
]

export const CTRADER_INTERVALS = INTERVALS.filter((interval) => interval.ctrader)

/** Accepts a code (case-sensitive), an enum name or a broker alias (case-insensitive), like Intervals.TryParse. */
export function parseInterval(text: string | null | undefined): IntervalInfo | null {
  const value = (text ?? '').trim()
  if (!value) return null
  const byCode = INTERVALS.find((interval) => interval.code === value)
  if (byCode) return byCode
  const lower = value.toLowerCase()
  return INTERVALS.find((interval) => interval.name.toLowerCase() === lower || interval.alias?.toLowerCase() === lower) ?? null
}

export const intervalCode = (name: IntervalName | string) => parseInterval(name)?.code ?? name

/** "XAUUSD 1h", as MarketId.ToString() writes it. */
export const marketLabel = (market: { symbol: string; interval: string }) => `${market.symbol} ${intervalCode(market.interval)}`

/** Symbols that never store or trade weekend candles (Domain/MarketCalendar.cs). */
export const WEEKEND_CLOSED = new Set(['XAUUSD', 'XAGUSD', 'XAUTUSDT', 'XAGUSDT', 'EURPLN', 'EURUSD'])

/** The bot downloads history since this date (Market/MarketDataSync.cs). */
export const HISTORY_START = Date.UTC(2019, 0, 1)

/** About how many candles `market add` will store, for the download estimate. */
export function expectedCandles(symbol: string, interval: IntervalInfo, now = Date.now()): number {
  const span = Math.max(0, now - HISTORY_START)
  const all = Math.floor(span / interval.ms)
  if (!WEEKEND_CLOSED.has(symbol.toUpperCase()) || interval.ms > DAY) return all
  return Math.round((all * 5) / 7)
}
