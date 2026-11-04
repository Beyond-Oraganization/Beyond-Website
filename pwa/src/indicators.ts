import type { CandleRow } from './api/parse/markets.ts'

/**
 * The bot's indicators (Indicators/Indicator.cs), for drawing bands on the device without loading the market
 * into the bot's memory:
 * - EMA of the close, weighting 2 / (depth + 1); the first value blends the first close with its open;
 * - ATR: Wilder's average (1 / depth) of each candle's high − low range.
 * Over a window, start the averages `warmup` candles early: after ten depths their start no longer shows
 * at the precision the bot prints.
 */
export function indicatorSeries(candles: CandleRow[], depth: number): { ema: number[]; atr: number[] } {
  const ema: number[] = []
  const atr: number[] = []
  const weighting = 2 / (depth + 1)
  candles.forEach((candle, i) => {
    ema.push(candle.close * weighting + (i ? ema[i - 1]! : candle.open) * (1 - weighting))
    const range = candle.high - candle.low
    atr.push(i ? (atr[i - 1]! * (depth - 1) + range) / depth : range)
  })
  return { ema, atr }
}

export const warmupFor = (depth: number) => Math.min(5000, depth * 10)

export type Band = { name: string; side: 'lower' | 'upper'; line: number; values: { time: number; value: number }[] }

/** The adaptive envelope (Indicators/AdaptiveEnvelope.cs): line i sits ATR × deviation × i from the EMA. */
export function envelope(candles: CandleRow[], depth: number, deviation: number, lines: number, show: number): { center: { time: number; value: number }[]; bands: Band[] } {
  const { ema, atr } = indicatorSeries(candles, depth)
  const from = Math.max(0, candles.length - show)
  const at = (i: number) => candles[i]!.time
  const center = candles.slice(from).map((_, k) => ({ time: at(from + k), value: ema[from + k]! }))
  const bands: Band[] = []
  for (let line = 1; line <= lines; line++)
    for (const side of ['lower', 'upper'] as const)
      bands.push({
        name: `${side === 'lower' ? 'EMA −' : 'EMA +'} ${line === 1 ? '' : `${line}×`}ATR×${deviation}`.replace('  ', ' '),
        side,
        line,
        values: candles.slice(from).map((_, k) => {
          const i = from + k
          const spacing = atr[i]! * deviation * line
          return { time: at(i), value: side === 'lower' ? ema[i]! - spacing : ema[i]! + spacing }
        }),
      })
  return { center, bands }
}
