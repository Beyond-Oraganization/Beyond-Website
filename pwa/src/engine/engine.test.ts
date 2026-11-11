import { describe, expect, it } from 'vitest'
import { createEngine, EngineCancelled, poolSize, shareSize, type EngineWorker } from './engine.ts'
import type { CandleColumns, DeviceScenarios, EngineRequest, ScenarioResult } from './types.ts'
import type { WorkerCall, WorkerReply } from './worker.ts'

/**
 * The engine's worker pool, with fake workers that answer as the bot's engine does: one result per scenario of the
 * share they were given. The real engine is the bot's code, tested there and end to end.
 */

const request: EngineRequest = { strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', scenarios: { method: 'Bootstrap', seed: 42 } }
const candles: CandleColumns = { time: new Float64Array(3), open: new Float64Array(3), high: new Float64Array(3), low: new Float64Array(3), close: new Float64Array(3), volume: new Float64Array(3) }

const result = (scenario: number): ScenarioResult => ({ scenario, finalBalance: 1000 + scenario, returnPercent: 0, maxDrawdownPercent: 0, trades: 1, winRate: 0, points: [1000] })

type Simulate = Extract<WorkerCall, { kind: 'simulate' }>

class FakeWorker implements EngineWorker {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  calls: Simulate[] = []

  constructor(private readonly answer: (call: Simulate) => object | null) {}

  postMessage(call: WorkerCall) {
    if (call.kind !== 'simulate') return
    this.calls.push(call)
    const reply = this.answer(call)
    // A real worker answers later, never in the same turn.
    if (reply) setTimeout(() => this.onmessage?.({ data: { id: call.id, value: JSON.stringify(reply) } } as MessageEvent<WorkerReply>), 1)
  }

  terminate() {
    this.terminated = true
  }
}

const scenarios = (call: Simulate): DeviceScenarios => ({
  ok: true, engine: '2.2.0', method: 'Bootstrap', seed: 42, meanBlockLength: 36, drift: null, volatility: null, computedMs: 5,
  results: Array.from({ length: call.count }, (_, i) => result(call.first + i)).reverse(),
  prices: call.first < 20 ? [{ scenario: call.first, closes: [1, 2] }] : [],
})

function pool(workers: number, answer: (call: Simulate) => object | null = scenarios) {
  const started: FakeWorker[] = []
  const engine = createEngine({ base: 'https://app.test/engine/', workers, spawn: () => started[started.push(new FakeWorker(answer)) - 1]! })
  return { engine, started }
}

describe('a Monte Carlo on this device', () => {
  it('shares the scenarios out to the workers, and answers them in scenario order', async () => {
    const { engine, started } = pool(3)

    const answer = await engine.simulate(request, candles, 20)

    expect(answer.ok && answer.results.map((r) => r.scenario)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(started).toHaveLength(3)
    expect(started.every((worker) => worker.calls.length > 0)).toBe(true)
  })

  it('gives every share the same request, so every worker makes its scenarios with the same seed', async () => {
    const { engine, started } = pool(3)

    await engine.simulate(request, candles, 20)

    const asked = new Set(started.flatMap((worker) => worker.calls.map((call) => call.request)))
    expect([...asked]).toEqual([JSON.stringify(request)])
  })

  it('says how many scenarios are done after each share', async () => {
    const { engine } = pool(2)
    const progress: number[] = []

    await engine.simulate(request, candles, 30, { onProgress: (done) => progress.push(done) })

    expect(progress.at(-1)).toBe(30)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(progress.length).toBeGreaterThan(2)
  })

  it('starts no more workers than there are scenarios', async () => {
    const { engine, started } = pool(6)

    await engine.simulate(request, candles, 2)

    expect(started).toHaveLength(2)
  })

  it('answers the engine’s message for a request it refuses', async () => {
    const { engine } = pool(2, (call) => ({ ok: false, engine: '2.2.0', error: { message: `refused ${call.first}` } }))

    const answer = await engine.simulate(request, candles, 10)

    expect(answer.ok).toBe(false)
  })

  it('stops every worker when cancelled', async () => {
    const { engine, started } = pool(3, () => null)
    const controller = new AbortController()

    const running = engine.simulate(request, candles, 20, { signal: controller.signal })
    controller.abort()

    await expect(running).rejects.toBeInstanceOf(EngineCancelled)
    expect(started.every((worker) => worker.terminated)).toBe(true)
  })

  it('runs in one worker per spare core, at most 6, fewer where memory is short', () => {
    expect(poolSize({ cores: 10 })).toBe(6)
    expect(poolSize({ cores: 4 })).toBe(3)
    expect(poolSize({ cores: 1 })).toBe(1)
    expect(poolSize({ cores: 8, memoryGb: 4 })).toBe(2)
    expect(poolSize({ cores: 8, memoryGb: 8 })).toBe(5)
    expect(poolSize({ cores: 6, touch: true })).toBe(3)
  })

  it('makes shares small enough to report progress often, and at most 25 scenarios', () => {
    expect([shareSize(200, 6), shareSize(1000, 6), shareSize(3, 6)]).toEqual([7, 25, 1])
  })
})
