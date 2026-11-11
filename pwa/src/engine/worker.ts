/**
 * A Web Worker that runs the bot's backtest engine (its Core, compiled to WebAssembly), so a backtest never blocks
 * the page. The .NET runtime starts on the first message and stays up for the next ones. A Monte Carlo runs in
 * several of these at once, each with its share of the scenarios.
 */

import type { CandleColumns } from './types.ts'

export type WorkerCall =
  | { id: number; base: string; kind: 'version' }
  | { id: number; base: string; kind: 'backtest'; request: string; candles: CandleColumns }
  | { id: number; base: string; kind: 'simulate'; request: string; candles: CandleColumns; first: number; count: number }
  | { id: number; base: string; kind: 'summarize'; request: string }

export type WorkerReply = { id: number; value: string } | { id: number; error: string }

type Columns = [openTimes: number[], open: number[], high: number[], low: number[], close: number[], volume: number[]]

type EngineExports = {
  Version: () => string
  Backtest: (request: string, ...columns: Columns) => string
  Simulate: (request: string, ...columnsThenRange: [...Columns, first: number, count: number]) => string
  Summarize: (request: string) => string
}

type DotnetModule = {
  dotnet: { create: () => Promise<{ getConfig: () => { mainAssemblyName?: string }; getAssemblyExports: (name: string) => Promise<unknown> }> }
}

let engine: Promise<EngineExports> | null = null

// The app's TypeScript knows the page's globals, not a worker's: name only what this worker uses.
const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerCall>) => void) => void
  postMessage: (message: WorkerReply) => void
}

/** Starts .NET from the engine folder (`engine/framework/dotnet.js`, published by the bot's scripts/publish-engine.sh). */
async function start(base: string): Promise<EngineExports> {
  const { dotnet } = (await import(/* @vite-ignore */ new URL('framework/dotnet.js', base).href)) as DotnetModule
  const runtime = await dotnet.create()
  const exports = (await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName ?? 'BeyondBot.Browser')) as { BeyondBot: { Browser: { Engine: EngineExports } } }
  return exports.BeyondBot.Browser.Engine
}

/** .NET takes plain arrays of numbers; a typed array would not marshal as one. */
const columns = ({ time, open, high, low, close, volume }: CandleColumns): Columns => [
  Array.from(time),
  Array.from(open),
  Array.from(high),
  Array.from(low),
  Array.from(close),
  Array.from(volume),
]

function answer(exports: EngineExports, call: WorkerCall): string {
  switch (call.kind) {
    case 'version':
      return exports.Version()
    case 'backtest':
      return exports.Backtest(call.request, ...columns(call.candles))
    case 'simulate':
      return exports.Simulate(call.request, ...columns(call.candles), call.first, call.count)
    case 'summarize':
      return exports.Summarize(call.request)
  }
}

// A listener, never `self.onmessage`: .NET's runtime takes over a worker's onmessage while it starts, and with one
// assigned dotnet.create() never resolves (found with the app's end-to-end tests).
scope.addEventListener('message', async ({ data }: MessageEvent<WorkerCall>) => {
  try {
    engine ??= start(data.base)
    scope.postMessage({ id: data.id, value: answer(await engine, data) })
  } catch (error) {
    engine = null
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})
