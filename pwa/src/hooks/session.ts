import { useEffect, useState } from 'react'
import { queryClient, queryKey, useBot, useCommand, type CommandData } from '../api/bot.ts'
import { cmd } from '../api/commands.ts'
import { marketLabel } from '../api/intervals.ts'
import { parseIso } from '../api/parse/format.ts'
import { parseSession } from '../api/session.ts'
import type { SessionSnapshot } from '../api/types.ts'
import { useLogs } from '../state/logs.ts'
import { useSettings } from '../state/settings.ts'
import { useOnline, useVisible } from './env.ts'

export const SESSION_ARGS = cmd.session()
type SessionData = CommandData<SessionSnapshot>

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('beyond-bot') : null
channel?.addEventListener('message', (event: MessageEvent<{ id: string; data: SessionData }>) => {
  const { id, data } = event.data ?? {}
  if (id && data) queryClient.setQueryData(queryKey(id, 'session', SESSION_ARGS), data, { updatedAt: data.at })
})

type Locks = { request: (name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>) => Promise<void> }

/**
 * Only one visible tab polls each bot: they queue for a Web Lock, and the holder shares its answers over a
 * BroadcastChannel. When it is hidden or closed the next tab takes over.
 */
function usePollLeader(id: string | undefined, visible: boolean): boolean {
  const locks = (navigator as Navigator & { locks?: Locks }).locks
  const [held, setHeld] = useState<string | null>(null)
  useEffect(() => {
    if (!id || !visible || !locks) return
    let release = () => {}
    const holding = new Promise<void>((resolve) => (release = resolve))
    const controller = new AbortController()
    locks
      .request(`beyond-bot-poll:${id}`, { signal: controller.signal }, async () => {
        setHeld(id)
        await holding
      })
      .catch(() => {})
    return () => {
      setHeld(null)
      release()
      controller.abort()
    }
  }, [id, visible, locks])
  return Boolean(id && visible && (!locks || held === id))
}

/** The session snapshot for screens (reads the shared cache; the runtime keeps it fresh). */
export function useSessionData() {
  const { refreshSeconds } = useSettings()
  return useCommand('session', SESSION_ARGS, parseSession, { priority: 'view', staleTime: refreshSeconds * 1000, persist: true })
}

/** The server's clock minus this device's, from the snapshot's `time` (countdowns use the bot's time). */
export const clockOffset = (data: SessionData | undefined) => (data?.parsed.ok ? (parseIso(data.parsed.value.time) ?? data.at) - data.at : 0)

/**
 * Keeps the session fresh: every few seconds while visible and online, once more just after a strategy's next
 * tick (ticks are aligned to the interval), and records each new tick in the device's feed. Mounted once.
 */
export function useSessionRuntime() {
  const { connection } = useBot()
  const { refreshSeconds } = useSettings()
  const visible = useVisible()
  const online = useOnline()
  const leader = usePollLeader(connection?.id, visible)
  const query = useCommand('session', SESSION_ARGS, parseSession, {
    priority: 'poll',
    refetchInterval: visible && online && leader ? refreshSeconds * 1000 : false,
    persist: true,
    staleTime: refreshSeconds * 500,
  })
  const data = query.data
  const snapshot = data?.parsed.ok ? data.parsed.value : null

  useEffect(() => {
    if (leader && data && connection) channel?.postMessage({ id: connection.id, data })
  }, [data, leader, connection])

  useEffect(() => {
    if (!leader || !snapshot) return
    const next = Math.min(...snapshot.strategies.map((s) => parseIso(s.nextTickAt) ?? Infinity))
    if (!Number.isFinite(next)) return
    const wait = next - clockOffset(data) - Date.now() + 3000
    if (wait <= 0 || wait > 6 * 3600_000) return
    const timer = setTimeout(() => void query.refetch(), wait)
    return () => clearTimeout(timer)
  }, [snapshot, leader, data, query])

  useTickRecorder(connection?.id, snapshot)
  return query
}

function useTickRecorder(id: string | undefined, snapshot: SessionSnapshot | null) {
  const loadFor = useLogs((state) => state.loadFor)
  useEffect(() => {
    if (id) void loadFor(id)
  }, [id, loadFor])

  useEffect(() => {
    if (!id || !snapshot) return
    const { ticks, addTick } = useLogs.getState()
    const feed = ticks[id] ?? []
    for (const session of snapshot.strategies) {
      const tick = session.lastTick
      if (!tick) continue
      const market = marketLabel(session.market)
      const last = [...feed].reverse().find((entry) => entry.kind === 'tick' && marketLabel(entry.tick.market) === market)
      if (last?.kind === 'tick' && last.tick.time === tick.time) continue
      if (last?.kind === 'tick' && session.ticks - last.ticksCount > 1)
        addTick(id, { kind: 'gap', market, missed: session.ticks - last.ticksCount - 1, at: Date.now() })
      addTick(id, { kind: 'tick', tick, ticksCount: session.ticks })
    }
  }, [id, snapshot])
}
