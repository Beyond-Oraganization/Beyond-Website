import { create } from 'zustand'
import type { Finished } from '../api/queue.ts'
import type { TickReport } from '../api/types.ts'
import { db } from './db.ts'

/**
 * Two local logs, per bot: the ticks this device saw (the bot keeps no history the API can read, only each
 * session's last tick), and the commands this device ran (already redacted by the queue).
 */
export type TickEntry = { kind: 'tick'; tick: TickReport; ticksCount: number } | { kind: 'gap'; market: string; missed: number; at: number }

const LIMIT = 500

type Logs = {
  ticks: Record<string, TickEntry[]>
  activity: Record<string, Finished[]>
  loadFor: (connectionId: string) => Promise<void>
  addTick: (connectionId: string, entry: TickEntry) => void
  addActivity: (connectionId: string, entry: Finished) => void
  clear: (connectionId: string, which: 'ticks' | 'activity') => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const later = (key: string, value: unknown) => {
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(() => void db.set(key, value), 800))
}

export const useLogs = create<Logs>((set, get) => ({
  ticks: {},
  activity: {},
  async loadFor(id) {
    if (get().ticks[id] && get().activity[id]) return
    const [ticks, activity] = await Promise.all([db.get<TickEntry[]>(`ticks:${id}`), db.get<Finished[]>(`activity:${id}`)])
    set({ ticks: { ...get().ticks, [id]: ticks ?? [] }, activity: { ...get().activity, [id]: activity ?? [] } })
  },
  addTick(id, entry) {
    const list = [...(get().ticks[id] ?? []), entry].slice(-LIMIT)
    set({ ticks: { ...get().ticks, [id]: list } })
    later(`ticks:${id}`, list)
  },
  addActivity(id, entry) {
    const list = [...(get().activity[id] ?? []), entry].slice(-LIMIT)
    set({ activity: { ...get().activity, [id]: list } })
    later(`activity:${id}`, list)
  },
  clear(id, which) {
    set({ [which]: { ...get()[which], [id]: [] } } as Partial<Logs>)
    void db.set(`${which}:${id}`, [])
  },
}))

// One shared empty list: a selector that returned a fresh [] each time would re-render its screen forever.
const NONE: never[] = []
/** The ticks this device saw for a bot, oldest first. */
export const useTicks = (connectionId: string | undefined): TickEntry[] => useLogs((state) => (connectionId ? state.ticks[connectionId] : undefined) ?? NONE)
/** The commands this device ran on a bot, oldest first. */
export const useActivity = (connectionId: string | undefined): Finished[] => useLogs((state) => (connectionId ? state.activity[connectionId] : undefined) ?? NONE)
