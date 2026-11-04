import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { useActive, useConnections } from '../state/connections.ts'
import { db } from '../state/db.ts'
import { useLogs } from '../state/logs.ts'
import { answered, CommandFailure, type Answered, type Outcome } from './client.ts'
import { CommandQueue, type Busy, type Priority } from './queue.ts'
import type { Parsed } from './parse/blocks.ts'
import type { CommandResult } from './types.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    // Nothing is retried on its own: the bot is one queue shared by every client, and actions must never repeat.
    queries: { retry: false, staleTime: 2000, gcTime: 30 * 60_000, networkMode: 'always', refetchOnWindowFocus: true },
    mutations: { retry: false, networkMode: 'always' },
  },
})

/** What the app knows about a bot's reachability, from every answer it got. */
export type BotHealth = { signedOut: boolean; unauthorized: boolean; unreachable: boolean; lastOkAt: number | null }
const healthy: BotHealth = { signedOut: false, unauthorized: false, unreachable: false, lastOkAt: null }

export const useHealth = create<{ byId: Record<string, BotHealth>; report: (id: string, kind: Outcome['kind'], command: string) => void }>((set, get) => ({
  byId: {},
  report(id, kind, command) {
    const now = get().byId[id] ?? healthy
    const next: BotHealth = { ...now }
    if (kind === 'unreachable') next.unreachable = true
    else if (kind !== 'cancelled') next.unreachable = false
    if (kind === 'unauthorized') next.unauthorized = true
    else if (kind !== 'unreachable' && kind !== 'cancelled') next.unauthorized = false
    if (kind === 'signedOut') next.signedOut = true
    if (kind === 'ok' && /^(session|balance|positions|login|credentials|signal|trading|orders place|orders close|market add|market sync)\b/.test(command)) next.signedOut = false
    if (kind === 'ok' || kind === 'failed' || kind === 'usage' || kind === 'signedOut') next.lastOkAt = Date.now()
    if (JSON.stringify(next) !== JSON.stringify(now)) set({ byId: { ...get().byId, [id]: next } })
  },
}))

const queues = new Map<string, CommandQueue>()

/** One queue per bot, so the device never sends two commands to it at once. */
export function queueFor(id: string): CommandQueue {
  let queue = queues.get(id)
  if (!queue) {
    queue = new CommandQueue(() => {
      const state = useConnections.getState()
      const connection = state.connections.find((c) => c.id === id)
      const key = state.keys[id]
      return connection && key ? { url: connection.url, key } : null
    })
    queue.onFinished((finished) => {
      useHealth.getState().report(id, finished.outcome, finished.command)
      // Successful background polls would bury everything else; failures and actions are kept.
      if (finished.priority !== 'poll' || finished.outcome !== 'ok') useLogs.getState().addActivity(id, finished)
    })
    queues.set(id, queue)
  }
  return queue
}

export function useBot() {
  const { connection, key } = useActive()
  const queue = connection ? queueFor(connection.id) : null
  return { connection, key, queue, ready: Boolean(connection && key) }
}

const idle = () => () => {}
const nothing = () => null

/** What the bot is running for this device right now, for the busy bar and the connection chip. */
export function useBusy(): Busy | null {
  const { queue } = useBot()
  return useSyncExternalStore(queue?.subscribe ?? idle, queue?.busy ?? nothing, nothing)
}

export function useBotHealth(): BotHealth {
  const { connection } = useBot()
  return useHealth((state) => (connection ? (state.byId[connection.id] ?? healthy) : healthy))
}

export type CommandData<T> = { result: CommandResult; parsed: Parsed<T>; at: number; roundTripMs: number }

// An accepted exit code still needs an answer without an error (status exits 1 when the database is down).
const ok = (outcome: Outcome, accept: number[]): outcome is Answered =>
  outcome.kind === 'ok' || (answered(outcome) && accept.includes(outcome.result.exitCode) && !outcome.result.error)

export const queryKey = (connectionId: string | undefined, name: string, args: string[]) => ['bot', connectionId ?? 'none', name, ...args]

/**
 * A read from the bot, cached per bot. The answer is read with `parse`; when that fails the screen shows the
 * answer as the bot printed it. `accept` lists exit codes that still carry a usable answer (status exits 1
 * when the database is down). `persist` keeps the last answer on the device for starting offline.
 */
export function useCommand<T>(
  name: string,
  args: string[] | null,
  parse: (result: CommandResult) => Parsed<T>,
  options: { priority?: Priority; refetchInterval?: number | false; enabled?: boolean; accept?: number[]; persist?: boolean; staleTime?: number } = {},
) {
  const { connection, queue, ready } = useBot()
  return useQuery<CommandData<T>, CommandFailure>({
    queryKey: queryKey(connection?.id, name, args ?? []),
    enabled: ready && args !== null && (options.enabled ?? true),
    refetchInterval: options.refetchInterval,
    staleTime: options.staleTime ?? 2000,
    queryFn: async ({ signal }) => {
      const outcome = await queue!.run(args!, { priority: options.priority ?? 'view', signal })
      if (!ok(outcome, options.accept ?? [])) throw new CommandFailure(outcome)
      const data: CommandData<T> = { result: outcome.result, parsed: parse(outcome.result), at: Date.now(), roundTripMs: outcome.roundTripMs }
      if (options.persist && connection) void db.set(`cache:${connection.id}:${name}`, { key: queryKey(connection.id, name, args!), data })
      return data
    },
  })
}

/** Puts the answers this device remembered for a bot back in the cache (shown under "as of …" when offline). */
export async function restoreCache(connectionId: string) {
  for (const [, saved] of await db.prefixed<{ key: unknown[]; data: CommandData<unknown> }>(`cache:${connectionId}:`)) {
    if (!queryClient.getQueryData(saved.key)) queryClient.setQueryData(saved.key, saved.data, { updatedAt: saved.data.at })
  }
}

/**
 * Runs an action (orders, trading, markets, logins) ahead of every read, then refreshes what it changed. It
 * throws a CommandFailure carrying the bot's message and hint. It never retries.
 */
export function useAction() {
  const { connection, queue } = useBot()
  const client = useQueryClient()
  return useCallback(
    async (args: string[], options: { invalidate?: string[]; accept?: number[]; signal?: AbortSignal } = {}): Promise<CommandResult> => {
      if (!queue || !connection) throw new CommandFailure({ kind: 'unreachable', reason: 'No bot is connected.' })
      const outcome = await queue.run(args, { priority: 'interactive', signal: options.signal, share: false })
      if (!ok(outcome, options.accept ?? [])) throw new CommandFailure(outcome)
      for (const name of new Set(['session', ...(options.invalidate ?? [])])) void client.invalidateQueries({ queryKey: ['bot', connection.id, name] })
      return outcome.result
    },
    [client, connection, queue],
  )
}
