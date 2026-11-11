import type { WorkerCall, WorkerReply } from './worker.ts'
import type { CandleColumns, DeviceScenarios, EngineAnswer, EngineRequest, SimulateAnswer, SummaryAnswer, SummaryRequest } from './types.ts'

/** Backtests on this device: the bot's own engine, in Web Workers. */
export interface Engine {
  /** Answers the request over the candles, or the bot's message for a wrong one; rejects when the engine cannot run. */
  backtest(request: EngineRequest, candles: CandleColumns, signal?: AbortSignal): Promise<EngineAnswer>
  /**
   * Backtests scenarios 0 to `count` − 1 of alternative price histories, shared out to several workers, and answers
   * them in scenario order. `onProgress` hears how many are done after each share.
   */
  simulate(request: EngineRequest, candles: CandleColumns, count: number, options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<SimulateAnswer>
  /** Sums up the scenarios and ranks the real history among them. */
  summarize(request: SummaryRequest, signal?: AbortSignal): Promise<SummaryAnswer>
}

/** What the engine needs of a Web Worker; tests give it a fake one. */
export type EngineWorker = {
  postMessage(message: WorkerCall): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export type EngineOptions = {
  /** The engine's files: `engine/version.json` and `engine/framework/`. */
  base?: string
  /** The most workers a Monte Carlo runs in. */
  workers?: number
  spawn?: (name: string) => EngineWorker
}

/** The engine's own files, beside the app: `engine/version.json` and `engine/framework/`. */
export const engineBase = () => new URL('engine/', document.baseURI).href

/** What {@link poolSize} reads of the device; tests pass their own. */
export type DeviceTraits = { cores?: number; memoryGb?: number; touch?: boolean }

const thisDevice = (): DeviceTraits => ({
  cores: globalThis.navigator?.hardwareConcurrency,
  memoryGb: (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory,
  touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
})

/**
 * How many workers a Monte Carlo runs in: one per spare core, at most 6. Each loads its own engine and holds about
 * 150 to 200 MB while it works (measured with 45,000 candles in Chromium), so a device that says how much memory it
 * has gets one worker per 1.5 GB of it, and a phone that does not say (Safari) gets at most 3.
 */
export function poolSize({ cores = 2, memoryGb, touch = false }: DeviceTraits = thisDevice()): number {
  const byMemory = memoryGb ? Math.floor(memoryGb / 1.5) : touch ? 3 : 6
  return Math.max(1, Math.min(6, cores - 1, byMemory))
}

/** The engine was stopped before it answered (the person cancelled). */
export class EngineCancelled extends Error {
  constructor() {
    super('The backtest was cancelled.')
  }
}

const spawnWorker = (name: string): EngineWorker => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name })

/** Scenarios per call: small enough to report progress often, big enough that sending the candles costs little. */
export const shareSize = (count: number, workers: number) => Math.max(1, Math.min(25, Math.ceil(count / (workers * 5))))

/**
 * Workers started when first needed and kept for the next calls (starting .NET again would cost a second). The first
 * one backtests and sums up; a Monte Carlo uses up to `workers` of them. Cancelling stops them all; the next call
 * starts fresh ones.
 */
export function createEngine({ base = engineBase(), workers = poolSize(), spawn = spawnWorker }: EngineOptions = {}): Engine {
  const running: (EngineWorker | null)[] = []
  const waiting = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>()
  let next = 0

  const stop = (error: Error) => {
    running.forEach((worker) => worker?.terminate())
    running.length = 0
    for (const call of waiting.values()) call.reject(error)
    waiting.clear()
  }

  const worker = (index: number) => {
    const existing = running[index]
    if (existing) return existing
    const started = spawn(index ? `backtest engine ${index + 1}` : 'backtest engine')
    started.onmessage = ({ data }) => {
      const call = waiting.get(data.id)
      waiting.delete(data.id)
      if ('error' in data) call?.reject(new Error(`The backtest engine failed: ${data.error}`))
      else call?.resolve(data.value)
    }
    started.onerror = (event) => {
      event.preventDefault()
      stop(new Error(`The backtest engine could not start: ${event.message || 'its files did not load'}.`))
    }
    running[index] = started
    return started
  }

  type Message = WorkerCall extends infer Call ? (Call extends WorkerCall ? Omit<Call, 'id' | 'base'> : never) : never
  const call = (index: number, message: Message, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      if (signal?.aborted) return reject(new EngineCancelled())
      const id = ++next
      waiting.set(id, { resolve, reject })
      signal?.addEventListener('abort', () => stop(new EngineCancelled()), { once: true })
      worker(index).postMessage({ ...message, id, base } as WorkerCall)
    })

  return {
    async backtest(request, candles, signal) {
      return JSON.parse(await call(0, { kind: 'backtest', request: JSON.stringify(request), candles }, signal)) as EngineAnswer
    },

    async simulate(request, candles, count, { signal, onProgress } = {}) {
      const size = Math.max(1, Math.min(workers, count))
      const step = shareSize(count, size)
      const shares: [first: number, count: number][] = []
      for (let first = 0; first < count; first += step) shares.push([first, Math.min(step, count - first)])
      const text = JSON.stringify(request)
      const answers: DeviceScenarios[] = []
      let failure: SimulateAnswer | null = null
      let taken = 0
      let done = 0
      await Promise.all(
        Array.from({ length: size }, async (_, index) => {
          while (taken < shares.length && !failure) {
            const [first, share] = shares[taken++]!
            const answer = JSON.parse(await call(index, { kind: 'simulate', request: text, candles, first, count: share }, signal)) as SimulateAnswer
            if (!answer.ok) failure = answer
            else {
              answers.push(answer)
              done += share
              onProgress?.(done, count)
            }
          }
        }),
      )
      if (failure) return failure
      const [head] = answers
      if (!head) throw new Error('The engine ran no scenario.')
      return {
        ...head,
        results: answers.flatMap((answer) => answer.results).sort((a, b) => a.scenario - b.scenario),
        prices: answers.flatMap((answer) => answer.prices).sort((a, b) => a.scenario - b.scenario),
        computedMs: Math.max(...answers.map((answer) => answer.computedMs)),
      }
    },

    async summarize(request, signal) {
      return JSON.parse(await call(0, { kind: 'summarize', request: JSON.stringify(request) }, signal)) as SummaryAnswer
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
