import { afterAll, describe, expect, it } from 'vitest'
import { createBot } from '../mock-bot/bot.mjs'
import { parseCandles, parseIndicators } from './api/parse/markets.ts'
import type { CommandResult } from './api/types.ts'
import { envelope, indicatorSeries, warmupFor } from './indicators.ts'

const bot = createBot({ ticking: false, start: Date.UTC(2026, 10, 4, 10) })
afterAll(() => bot.stop())
const run = async (...args: string[]) => ({ ...(await bot.run(args)), command: '', elapsedMs: 0, ok: true }) as CommandResult

describe('indicators on the device', () => {
  it('match the bot’s indicator table once warmed up', async () => {
    const depth = 23
    const candles = parseCandles(await run('candles', 'show', 'XAUUSD', '1h', '--last', String(20 + warmupFor(depth))))
    const table = parseIndicators(await run('indicators', 'show', 'XAUUSD', '1h', '--depth', String(depth), '--last', '20'))
    if (!candles.ok || !table.ok) throw new Error('unreadable')
    const { ema, atr } = indicatorSeries(candles.value, depth)
    const offset = candles.value.length - 20
    table.value.rows.forEach((row, i) => {
      expect(ema[offset + i]).toBeCloseTo(row.ema, 2)
      expect(atr[offset + i]).toBeCloseTo(row.atr, 2)
    })
  })

  it('draws the envelope lines ATR × deviation × line from the EMA', () => {
    const candles = Array.from({ length: 40 }, (_, i) => ({ time: i * 3600_000, open: 100, high: 102, low: 98, close: 100, volume: 1 }))
    const { center, bands } = envelope(candles, 5, 2, 2, 10)
    expect(center).toHaveLength(10)
    expect(bands.map((b) => `${b.side}${b.line}`)).toEqual(['lower1', 'upper1', 'lower2', 'upper2'])
    expect(bands[0]!.values.at(-1)!.value).toBeCloseTo(100 - 4 * 2 * 1)
    expect(bands[3]!.values.at(-1)!.value).toBeCloseTo(100 + 4 * 2 * 2)
  })
})
