import { db } from '../state/db.ts'
import { isDeviceRun, type SavedRun, type ScenarioDetails } from './runs.ts'

/**
 * The runs this device keeps per bot connection, one key each (`runs:<connection>:<id>`), so saving one never
 * rewrites the others. A Monte Carlo's details (every scenario's path) are kept apart (`run-details:…`) and read only
 * when the run is shown. In a browser only the newest {@link BROWSER_RUNS} runs are kept, without details; the
 * desktop app's database keeps every run and every detail.
 */
export const BROWSER_RUNS = 50

const runsPrefix = (connection: string) => `runs:${connection}:`
const runKey = (connection: string, id: string) => `${runsPrefix(connection)}${id}`
const detailsKey = (connection: string, id: string) => `run-details:${connection}:${id}`
/** Where runs were kept before 2.2.0: one list of the last 50. */
const oldListKey = (connection: string) => `backtests:${connection}`

/** The run as it is stored: without its Monte Carlo's details, which are stored apart or not at all. */
const light = (run: SavedRun): SavedRun => (isDeviceRun(run) && run.monteCarlo ? { ...run, monteCarlo: { ...run.monteCarlo, details: null } } : run)

/** Every run kept for the connection, oldest first; runs kept the old way, as one list, move onto their own keys. */
export async function loadRuns(connection: string): Promise<SavedRun[]> {
  const old = await db.get<SavedRun[]>(oldListKey(connection))
  if (old) {
    for (const run of old) await db.set(runKey(connection, run.id), run)
    await db.del(oldListKey(connection))
  }
  return (await db.prefixed<SavedRun>(runsPrefix(connection))).map(([, run]) => run).sort((a, b) => a.at - b.at)
}

/** Keeps the run; in a browser drops the oldest beyond {@link BROWSER_RUNS}. Answers every run now kept, oldest first. */
export async function saveRun(connection: string, run: SavedRun, { keepEverything }: { keepEverything: boolean }): Promise<SavedRun[]> {
  await db.set(runKey(connection, run.id), light(run))
  const details = isDeviceRun(run) ? run.monteCarlo?.details : null
  if (keepEverything && details) await db.set(detailsKey(connection, run.id), details)
  const runs = await loadRuns(connection)
  if (keepEverything) return runs
  for (const dropped of runs.slice(0, -BROWSER_RUNS)) await forget(connection, dropped.id)
  return runs.slice(-BROWSER_RUNS)
}

/** A run's Monte Carlo details, when this device kept them. */
export const loadDetails = (connection: string, id: string) => db.get<ScenarioDetails>(detailsKey(connection, id))

/** Forgets every run kept for the connection, with their details, however they were kept. */
export async function clearRuns(connection: string): Promise<void> {
  await db.del(oldListKey(connection))
  for (const key of [...(await db.prefixed(runsPrefix(connection))), ...(await db.prefixed(`run-details:${connection}:`))].map(([key]) => key)) await db.del(key)
}

async function forget(connection: string, id: string): Promise<void> {
  await db.del(runKey(connection, id))
  await db.del(detailsKey(connection, id))
}
