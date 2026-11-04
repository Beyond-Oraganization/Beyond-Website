import type { CommandResult } from '../src/api/types.ts'

export type MockBot = {
  run(args: string[], options?: { signal?: AbortSignal }): Promise<Omit<CommandResult, 'command' | 'elapsedMs' | 'ok'>>
  state: Record<string, unknown>
  now(): number
  advance(ms: number): void
  stop(): void
}

export function createBot(options?: {
  speed?: number
  start?: number
  seed?: number
  signedIn?: boolean
  trading?: boolean
  orderingBug?: boolean
  databaseDown?: boolean
  addDelayMs?: number
  history?: number
  ticking?: boolean
}): MockBot
