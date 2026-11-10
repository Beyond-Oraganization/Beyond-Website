/**
 * The Web Worker that runs the bot's backtest engine (its Core, compiled to WebAssembly), so a backtest never
 * blocks the page. The .NET runtime starts on the first message and stays up for the next ones.
 */

import type { CandleColumns } from './types.ts'

export type WorkerCall =
  | { id: number; base: string; kind: 'version' }
  | { id: number; base: string; kind: 'backtest'; request: string; candles: CandleColumns }

export type WorkerReply = { id: number; value: string } | { id: number; error: string }

type EngineExports = {
  Version: () => string
  Backtest: (request: string, openTimes: number[], open: number[], high: number[], low: number[], close: number[], volume: number[]) => string
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

// A listener, never `self.onmessage`: .NET's runtime takes over a worker's onmessage while it starts, and with one
// assigned dotnet.create() never resolves (found with the app's end-to-end tests).
scope.addEventListener('message', async ({ data }: MessageEvent<WorkerCall>) => {
  const reply = (message: WorkerReply) => scope.postMessage(message)
  try {
    engine ??= start(data.base)
    const exports = await engine
    if (data.kind === 'version') return reply({ id: data.id, value: exports.Version() })
    // .NET takes plain arrays of numbers; a typed array would not marshal as one.
    const { time, open, high, low, close, volume } = data.candles
    reply({ id: data.id, value: exports.Backtest(data.request, Array.from(time), Array.from(open), Array.from(high), Array.from(low), Array.from(close), Array.from(volume)) })
  } catch (error) {
    engine = null
    reply({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})
