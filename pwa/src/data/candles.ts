import { cmd } from '../api/commands.ts'
import type { CommandResult } from '../api/types.ts'
import type { CandleColumns } from '../engine/types.ts'
import { localStore } from '../storage/local-store.ts'

/**
 * This device's own copy of a market's candles, for backtests on the device. The first time it downloads the
 * market's whole history from the bot (`candles export`, page by page); after that it asks only from its newest
 * candle on. It is a cache: the candles live on the bot, so clearing it costs one download.
 *
 * Kept in `localStore('candles')` (IndexedDB database "beyond-bot-candles" in a browser, the SQLite file in the
 * desktop app), per bot connection and market, as number columns in chunks of 5,000 candles, so an update rewrites
 * only the last chunk.
 */

/** Candles per stored chunk, and per page asked of the bot. */
export const CHUNK = 5000

/** What is stored of one market. Times are in milliseconds. */
export type CopyInfo = {
  /** "XAUUSD 1h". */
  market: string
  /** The bot's oldest stored candle when the copy was made: when the bot's changes, the copy starts over. */
  first: number
  newest: number
  count: number
  chunks: number
  /** About how much storage it takes. */
  bytes: number
  updatedAt: number
}

/** Asks the bot, as `useRead()` does: the answer, or a thrown CommandFailure. */
export type Ask = (args: string[], signal?: AbortSignal) => Promise<CommandResult>

type Columns = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }
type StoredChunk = CandleColumns

const COLUMNS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const
const BYTES_PER_CANDLE = COLUMNS.length * 8

const storage = () => localStore('candles')

const metaKey = (connectionId: string, market: string) => `${connectionId}|${market}|meta`
const chunkKey = (connectionId: string, market: string, index: number) => `${connectionId}|${market}|${index}`

/** A page of the bot's `candles export --json` answer. */
export type CandlePage = { first: number; next: number | null; candles: number[][] }

/** Reads `candles export --json`; throws when the answer is not one (an app newer than the bot's format). */
export function readPage(result: CommandResult): CandlePage {
  const json = result.json as { first?: unknown; next?: unknown; candles?: unknown } | null
  if (!json || typeof json.first !== 'string' || !Array.isArray(json.candles)) throw new Error('The bot’s candle page could not be read.')
  return {
    first: Date.parse(json.first),
    next: typeof json.next === 'string' ? Date.parse(json.next) : null,
    candles: json.candles as number[][],
  }
}

const emptyColumns = (): Columns => ({ time: [], open: [], high: [], low: [], close: [], volume: [] })

const fromStored = (chunk: StoredChunk, rows: number): Columns => ({
  time: Array.from(chunk.time.subarray(0, rows)),
  open: Array.from(chunk.open.subarray(0, rows)),
  high: Array.from(chunk.high.subarray(0, rows)),
  low: Array.from(chunk.low.subarray(0, rows)),
  close: Array.from(chunk.close.subarray(0, rows)),
  volume: Array.from(chunk.volume.subarray(0, rows)),
})

const toStored = (columns: Columns): StoredChunk => ({
  time: Float64Array.from(columns.time),
  open: Float64Array.from(columns.open),
  high: Float64Array.from(columns.high),
  low: Float64Array.from(columns.low),
  close: Float64Array.from(columns.close),
  volume: Float64Array.from(columns.volume),
})

/** The candles stored in the last chunk, by the copy's count (a chunk written after an interrupted update may hold more). */
const rowsInLast = (info: CopyInfo) => info.count - (info.chunks - 1) * CHUNK

/**
 * Brings this device's copy of `market` up to date with the bot: the whole history the first time, then from the
 * newest stored candle on (the bot may have rewritten that one). Reports progress after each page.
 */
export async function updateCopy(
  connectionId: string,
  market: string,
  ask: Ask,
  { onProgress, signal }: { onProgress?: (info: CopyInfo) => void; signal?: AbortSignal } = {},
): Promise<CopyInfo> {
  const [symbol = '', interval = ''] = market.split(' ')
  let info = (await storage().get<CopyInfo>(metaKey(connectionId, market))) ?? null
  let startedOver = false

  for (;;) {
    let index = info ? info.chunks - 1 : 0
    let current = emptyColumns()
    if (info) {
      const last = await storage().get<StoredChunk>(chunkKey(connectionId, market, index))
      current = last ? fromStored(last, rowsInLast(info)) : emptyColumns()
    }
    let from = info ? info.newest : null
    let count = info ? info.count : 0

    for (;;) {
      const page = readPage(await ask(cmd.candlesExport(symbol, interval, from, CHUNK), signal))
      if (info && page.first !== info.first) break
      let rows = page.candles
      // The page starts with the copy's newest candle: take the bot's, which may have been rewritten since.
      if (count > 0 && rows.length && rows[0]![0] === current.time.at(-1)) {
        const at = current.time.length - 1
        COLUMNS.forEach((column, i) => (current[column][at] = rows[0]![i]!))
        rows = rows.slice(1)
      }
      for (const row of rows) {
        if (current.time.length === CHUNK) {
          await storage().set(chunkKey(connectionId, market, index), toStored(current))
          index++
          current = emptyColumns()
        }
        COLUMNS.forEach((column, i) => current[column].push(row[i]!))
        count++
      }
      if (count === 0) throw new Error(`The bot has no ${market} candles.`)
      await storage().set(chunkKey(connectionId, market, index), toStored(current))
      info = {
        market,
        first: page.first,
        newest: current.time.at(-1)! * 1000,
        count,
        chunks: index + 1,
        bytes: count * BYTES_PER_CANDLE,
        updatedAt: Date.now(),
      }
      await storage().set(metaKey(connectionId, market), info)
      onProgress?.(info)
      if (page.next == null) return info
      from = page.next
    }

    // The bot's history changed under the copy (the market was removed and added again): start over, once.
    if (startedOver) throw new Error(`The bot’s ${market} history keeps changing; try again.`)
    startedOver = true
    await deleteCopy(connectionId, market)
    info = null
  }
}

/** The stored copy as one set of columns for the engine, or null when there is none. */
export async function readCopy(connectionId: string, market: string): Promise<CandleColumns | null> {
  const info = await storage().get<CopyInfo>(metaKey(connectionId, market))
  if (!info) return null
  const columns = {} as CandleColumns
  for (const column of COLUMNS) columns[column] = new Float64Array(info.count)
  for (let index = 0; index < info.chunks; index++) {
    const chunk = await storage().get<StoredChunk>(chunkKey(connectionId, market, index))
    if (!chunk) return null
    const rows = index === info.chunks - 1 ? rowsInLast(info) : CHUNK
    for (const column of COLUMNS) columns[column].set(chunk[column].subarray(0, rows), index * CHUNK)
  }
  return columns
}

/** Every market this device keeps a copy of for the bot, newest update first. */
export async function listCopies(connectionId: string): Promise<CopyInfo[]> {
  const infos: CopyInfo[] = []
  for (const key of await storage().keys(`${connectionId}|`)) {
    if (key.endsWith('|meta')) {
      const info = await storage().get<CopyInfo>(key)
      if (info) infos.push(info)
    }
  }
  return infos.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteCopy(connectionId: string, market: string): Promise<void> {
  for (const key of await storage().keys(`${connectionId}|${market}|`)) await storage().delete(key)
}
