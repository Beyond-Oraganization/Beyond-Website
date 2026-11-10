import type { WorkerCall, WorkerReply } from './worker.ts'
import type { CandleColumns, EngineAnswer, EngineRequest } from './types.ts'

/** Backtests on this device: the bot's own engine, in a Web Worker. */
export interface Engine {
  /** Answers the request over the candles, or the bot's message for a wrong one; rejects when the engine cannot run. */
  backtest(request: EngineRequest, candles: CandleColumns, signal?: AbortSignal): Promise<EngineAnswer>
}

/** The engine's own files, beside the app: `engine/version.json` and `engine/framework/`. */
export const engineBase = () => new URL('engine/', document.baseURI).href

/** The engine was stopped before it answered (the person cancelled). */
export class EngineCancelled extends Error {
  constructor() {
    super('The backtest was cancelled.')
  }
}

/**
 * One worker, started on the first backtest and kept for the next ones (starting .NET again would cost a second).
 * Cancelling stops the worker; the next backtest starts a fresh one.
 */
export function createEngine(base = engineBase()): Engine {
  let worker: Worker | null = null
  let next = 0
  const waiting = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>()

  const stop = (error: Error) => {
    worker?.terminate()
    worker = null
    for (const call of waiting.values()) call.reject(error)
    waiting.clear()
  }

  const running = () => {
    if (worker) return worker
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'backtest engine' })
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      const call = waiting.get(data.id)
      waiting.delete(data.id)
      if ('error' in data) call?.reject(new Error(`The backtest engine failed: ${data.error}`))
      else call?.resolve(data.value)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      stop(new Error(`The backtest engine could not start: ${event.message || 'its files did not load'}.`))
    }
    return worker
  }

  const call = (message: WorkerCall, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      if (signal?.aborted) return reject(new EngineCancelled())
      waiting.set(message.id, { resolve, reject })
      signal?.addEventListener('abort', () => stop(new EngineCancelled()), { once: true })
      running().postMessage(message)
    })

  return {
    async backtest(request, candles, signal) {
      const text = await call({ id: ++next, base, kind: 'backtest', request: JSON.stringify(request), candles }, signal)
      return JSON.parse(text) as EngineAnswer
    },
  }
}

/** The version and commit the engine was built from (`engine/version.json`), or null without one. */
export async function engineVersion(base = engineBase()): Promise<{ version: string; commit: string } | null> {
  try {
    const response = await fetch(new URL('version.json', base))
    return response.ok ? ((await response.json()) as { version: string; commit: string }) : null
  } catch {
    return null
  }
}
