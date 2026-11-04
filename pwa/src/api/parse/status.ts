import type { CommandResult } from '../types.ts'
import { findGrid, findSection, gridMap, parsed, unreadable, type Parsed } from './blocks.ts'
import { parseDuration } from './format.ts'

export type StatusReading = {
  version: string | null
  uptime: number | null
  database: { connected: boolean; text: string; schema: number | null }
  user: string | null
  broker: { state: 'after-login' | 'connected' | 'disconnected'; text: string; mode: 'DEMO' | 'LIVE' | null }
  trading: number
  credentials: string
  log: string
}

/**
 * `status` (Cli/Commands/SessionCommands.cs): a "Status" panel with Version, Database, User, Broker, Trading,
 * Credentials and Log. The bot exits 1 with no error when the database is down; that is a status, not a failure.
 */
export function parseStatus(result: CommandResult): Parsed<StatusReading> {
  const panel = findSection(result.blocks, (title) => title === 'Status')
  const grid = panel ? findGrid(panel.blocks) : null
  if (!grid) return unreadable('No status panel in the answer.')
  const map = gridMap(grid)
  const version = /^(\S+), up (.+)$/.exec(map.get('Version') ?? '')
  const database = map.get('Database') ?? ''
  const broker = map.get('Broker') ?? ''
  const user = map.get('User') ?? ''
  return parsed({
    version: version?.[1] ?? null,
    uptime: parseDuration(version?.[2] ?? null),
    database: {
      connected: database.startsWith('connected'),
      text: database,
      schema: Number(/schema v(\d+)/.exec(database)?.[1] ?? NaN) || null,
    },
    user: !user || user === 'not logged in' ? null : user,
    broker: {
      state: broker.startsWith('connected') ? 'connected' : broker.startsWith('connects after login') ? 'after-login' : 'disconnected',
      text: broker,
      mode: /\bLIVE\b/.test(broker) ? 'LIVE' : /\bDEMO\b/.test(broker) ? 'DEMO' : null,
    },
    trading: Number(/^(\d+)/.exec(map.get('Trading') ?? '')?.[1] ?? 0),
    credentials: map.get('Credentials') ?? '',
    log: map.get('Log') ?? '',
  })
}
