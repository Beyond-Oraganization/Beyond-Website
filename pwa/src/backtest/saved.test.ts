import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../state/db.ts'
import { deviceAnswer, scenariosAnswer, summaryAnswer } from './fixtures.ts'
import { keep, keepScenarios, type DeviceRun, type SavedRun } from './runs.ts'
import { BROWSER_RUNS, clearRuns, loadDetails, loadRuns, saveRun } from './saved.ts'

/** The runs this device keeps, against the app's store (memory under jsdom, as in a browser without IndexedDB). */
let connection = ''
let n = 0

const run = (at: number): DeviceRun => ({
  kind: 'device', id: `run-${at}`, at, input: { strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', params: {} }, balance: 1000, from: null, to: null,
  scenarios: 3, method: 'Bootstrap', result: keep(deviceAnswer()), monteCarlo: keepScenarios(deviceAnswer(), scenariosAnswer(), summaryAnswer().summary),
})

beforeEach(() => {
  connection = `conn-${++n}`
})

describe('the runs kept on this device', () => {
  it('keeps a run and lists it, oldest first', async () => {
    await saveRun(connection, run(2), { keepEverything: false })
    await saveRun(connection, run(1), { keepEverything: false })

    expect((await loadRuns(connection)).map((kept) => kept.at)).toEqual([1, 2])
  })

  it('in a browser, keeps the newest 50 and only their summaries', async () => {
    for (let at = 1; at <= BROWSER_RUNS + 2; at++) await saveRun(connection, run(at), { keepEverything: false })

    const kept = await loadRuns(connection)
    expect([kept.length, kept[0]?.at]).toEqual([BROWSER_RUNS, 3])
    expect((kept[0] as DeviceRun).monteCarlo?.details).toBeNull()
    expect(await loadDetails(connection, 'run-3')).toBeUndefined()
  })

  it('in the desktop app, keeps every run, with every scenario’s path', async () => {
    for (let at = 1; at <= BROWSER_RUNS + 2; at++) await saveRun(connection, run(at), { keepEverything: true })

    expect(await loadRuns(connection)).toHaveLength(BROWSER_RUNS + 2)
    expect((await loadDetails(connection, 'run-1'))?.paths).toHaveLength(3)
  })

  it('moves runs kept the old way, as one list, onto their own keys', async () => {
    const old: SavedRun[] = [run(1), run(2)]
    await db.set(`backtests:${connection}`, old)

    expect((await loadRuns(connection)).map((kept) => kept.id)).toEqual(['run-1', 'run-2'])
    expect(await db.get(`backtests:${connection}`)).toBeUndefined()
  })

  it('forgets every run, and its details, when cleared', async () => {
    await saveRun(connection, run(1), { keepEverything: true })

    await clearRuns(connection)

    expect([await loadRuns(connection), await loadDetails(connection, 'run-1')]).toEqual([[], undefined])
  })
})
