import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../api/types.ts'
import { CHUNK, deleteCopy, listCopies, readCopy, readPage, updateCopy, type Ask } from './candles.ts'

const HOUR = 3600
const START = Date.UTC(2025, 0, 6) / 1000

/** Hourly candles [openTime (s), open, high, low, close, volume] from `start`. */
const hourly = (count: number, start = START, price = 100) =>
  Array.from({ length: count }, (_, i) => [start + i * HOUR, price + i, price + i + 2, price + i - 1, price + i + 1, 10 + i])

/**
 * A bot that answers `candles export` as the real one does: up to `--limit` candles from `--from` (a UTC time without
 * "Z"), with the oldest open time and where the next page starts.
 */
function fakeBot(stored: () => number[][]) {
  const asked: (number | null)[] = []
  const ask: Ask = async (args) => {
    const limit = Number(args[args.indexOf('--limit') + 1])
    const fromAt = args.indexOf('--from')
    const from = fromAt > 0 ? Date.parse(`${args[fromAt + 1]}Z`) / 1000 : null
    asked.push(from)
    const candles = stored()
    const after = candles.filter((row) => from == null || row[0]! >= from)
    const page = after.slice(0, limit)
    const next = after[limit]?.[0]
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z')
    return { exitCode: 0, ok: true, json: { first: iso(candles[0]![0]!), next: next != null ? iso(next) : null, candles: page } } as unknown as CommandResult
  }
  return { ask, asked }
}

let n = 0
const bot = () => `bot-${++n}`

describe('the candle copy', () => {
  it('downloads the whole history the first time, a page of 5,000 at a time', async () => {
    const history = hourly(12_345)
    const { ask, asked } = fakeBot(() => history)
    const id = bot()

    const info = await updateCopy(id, 'XAUUSD 1h', ask)
    const copy = await readCopy(id, 'XAUUSD 1h')

    expect(asked).toEqual([null, START + CHUNK * HOUR, START + 2 * CHUNK * HOUR])
    expect(info).toMatchObject({ count: 12_345, chunks: 3, first: START * 1000, newest: (START + 12_344 * HOUR) * 1000 })
    expect(copy?.time.length).toBe(12_345)
    expect([copy?.time[5000], copy?.close[12_344]]).toEqual([START + 5000 * HOUR, 100 + 12_344 + 1])
  })

  it('then asks only from its newest candle, and takes the bot’s version of that one', async () => {
    let history = hourly(5_000)
    const { ask, asked } = fakeBot(() => history)
    const id = bot()
    await updateCopy(id, 'XAUUSD 1h', ask)
    // The bot rewrote its newest candle and stored three more after it.
    history = [...history.slice(0, -1), [START + 4999 * HOUR, 1, 2, 0.5, 1.5, 7], ...hourly(3, START + 5000 * HOUR, 9000)]

    const info = await updateCopy(id, 'XAUUSD 1h', ask)
    const copy = await readCopy(id, 'XAUUSD 1h')

    expect(asked.at(-1)).toBe(START + 4999 * HOUR)
    expect(info).toMatchObject({ count: 5_003, chunks: 2 })
    expect([copy?.close[4999], copy?.close[5002]]).toEqual([1.5, 9003])
  })

  it('starts over when the bot’s history changed underneath it', async () => {
    let history = hourly(10)
    const { ask } = fakeBot(() => history)
    const id = bot()
    await updateCopy(id, 'XAUUSD 1h', ask)
    history = hourly(4, START + 100 * HOUR, 500)

    const info = await updateCopy(id, 'XAUUSD 1h', ask)

    expect(info).toMatchObject({ count: 4, first: (START + 100 * HOUR) * 1000 })
    expect((await readCopy(id, 'XAUUSD 1h'))?.open[0]).toBe(500)
  })

  it('lists each market it keeps, and forgets one when asked', async () => {
    const { ask } = fakeBot(() => hourly(10))
    const id = bot()
    await updateCopy(id, 'XAUUSD 1h', ask)
    await updateCopy(id, 'EURUSD 4h', ask)

    await deleteCopy(id, 'XAUUSD 1h')

    expect((await listCopies(id)).map((info) => info.market)).toEqual(['EURUSD 4h'])
    expect(await readCopy(id, 'XAUUSD 1h')).toBeNull()
  })

  it('says so when the bot’s answer is not a candle page', () => {
    expect(() => readPage({ json: { rows: [] } } as unknown as CommandResult)).toThrow('could not be read')
  })
})
