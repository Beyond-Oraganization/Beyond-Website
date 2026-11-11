import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { clearRuns } from '../backtest/saved.ts'
import { db } from './db.ts'
import { seal, unseal, type Sealed } from './vault.ts'

/**
 * How the API key is kept: sealed under a passphrase, sealed with a device key ("remember me": the bot opens
 * without asking), or not at all.
 */
export type KeyStorage = 'passphrase' | 'device' | 'session'

export type Connection = {
  id: string
  name: string
  url: string
  storage: KeyStorage
  sealed: Sealed | null
  addedAt: number
  lastOkAt?: number
  botVersion?: string | null
  /** Locked with "Lock the bot" while remembered: unlocking with the passphrase remembers it again. */
  relock?: boolean
}

type Saved = { connections: Connection[]; activeId: string | null; tokens?: Record<string, string> }

type ConnectionState = Saved & {
  loaded: boolean
  /** Unsealed API keys, in memory only. */
  keys: Record<string, string>
  /**
   * Each bot's connection token: what its first login answered with, sent with every command so the bot knows
   * which trading accounts this device signed in to. Kept on the device (useless without the API key) until the
   * bot says it expired; a restart of the bot forgets it too.
   */
  tokens: Record<string, string>
  setToken: (id: string, token: string | null) => Promise<void>
  load: () => Promise<void>
  add: (input: { name: string; url: string; key: string; storage: KeyStorage; passphrase?: string }) => Promise<Connection>
  update: (id: string, patch: Partial<Omit<Connection, 'id'>>) => Promise<void>
  replaceKey: (id: string, key: string, storage: KeyStorage, passphrase?: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setActive: (id: string | null) => Promise<void>
  unlock: (id: string, passphrase: string) => Promise<void>
  enterKey: (id: string, key: string) => void
  lock: () => void
  /**
   * Locks one bot. A remembered bot gets its key sealed under `passphrase` until it is unlocked with it (then it
   * is remembered again); a bot kept with a passphrase (`passphrase` null) or not kept only forgets the key.
   */
  lockWith: (id: string, passphrase: string | null) => Promise<void>
  /** Remember me: keeps the open key with the device key, so the bot opens without a passphrase. */
  remember: (id: string) => Promise<void>
}

const SAVED = 'connections'
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/** The bot's address, as typed: https://IP:8443 is the usual form; a bare host gets https://. */
export function normalizeUrl(input: string): string {
  const value = input.trim()
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const url = new URL(withScheme)
  return url.toString().replace(/\/$/, url.pathname === '/' ? '' : '/')
}

export const useConnections = create<ConnectionState>((set, get) => {
  const save = () => db.set(SAVED, { connections: get().connections, activeId: get().activeId, tokens: get().tokens } satisfies Saved)

  return {
    loaded: false,
    connections: [],
    activeId: null,
    keys: {},
    tokens: {},

    async load() {
      const saved = (await db.get<Saved>(SAVED)) ?? { connections: [], activeId: null }
      const keys: Record<string, string> = {}
      for (const connection of saved.connections) {
        if (connection.storage === 'device' && connection.sealed) {
          try {
            keys[connection.id] = await unseal(connection.id, connection.sealed)
          } catch {
            // the device key is gone (storage cleared): the key must be entered again
          }
        }
      }
      set({ connections: saved.connections, activeId: saved.activeId, tokens: saved.tokens ?? {}, keys, loaded: true })
    },

    async add({ name, url, key, storage, passphrase }) {
      const id = newId()
      const sealed = storage === 'session' ? null : await seal(id, key.trim(), storage === 'passphrase' ? (passphrase ?? '') : null)
      const connection: Connection = { id, name: name.trim() || new URL(normalizeUrl(url)).host, url: normalizeUrl(url), storage, sealed, addedAt: Date.now() }
      set({ connections: [...get().connections, connection], activeId: id, keys: { ...get().keys, [id]: key.trim() } })
      await save()
      return connection
    },

    async update(id, patch) {
      set({ connections: get().connections.map((c) => (c.id === id ? { ...c, ...patch, url: patch.url ? normalizeUrl(patch.url) : c.url } : c)) })
      await save()
    },

    async replaceKey(id, key, storage, passphrase) {
      const sealed = storage === 'session' ? null : await seal(id, key.trim(), storage === 'passphrase' ? (passphrase ?? '') : null)
      set({ connections: get().connections.map((c) => (c.id === id ? { ...c, storage, sealed } : c)), keys: { ...get().keys, [id]: key.trim() } })
      await save()
    },

    async remove(id) {
      const connections = get().connections.filter((c) => c.id !== id)
      const keys = { ...get().keys }
      delete keys[id]
      const tokens = { ...get().tokens }
      delete tokens[id]
      set({ connections, keys, tokens, activeId: get().activeId === id ? (connections[0]?.id ?? null) : get().activeId })
      await save()
      // Everything this device remembered about that bot goes too.
      await db.delPrefixed(`cache:${id}:`)
      await db.del(`ticks:${id}`)
      await db.del(`activity:${id}`)
      await clearRuns(id)
    },

    async setToken(id, token) {
      if ((get().tokens[id] ?? null) === token) return
      const tokens = { ...get().tokens }
      if (token) tokens[id] = token
      else delete tokens[id]
      set({ tokens })
      await save()
    },

    async setActive(id) {
      set({ activeId: id })
      await save()
    },

    async unlock(id, passphrase) {
      const connection = get().connections.find((c) => c.id === id)
      if (!connection?.sealed) throw new Error('This connection has no stored key.')
      const key = await unseal(id, connection.sealed, passphrase)
      set({ keys: { ...get().keys, [id]: key } })
      // Locked from "remember me": remember it again.
      if (connection.relock) await get().remember(id)
    },

    async lockWith(id, passphrase) {
      const connection = get().connections.find((c) => c.id === id)
      const key = get().keys[id]
      if (!connection) return
      if (connection.storage === 'device' && key && passphrase != null) {
        const sealed = await seal(id, key, passphrase)
        set({ connections: get().connections.map((c) => (c.id === id ? { ...c, storage: 'passphrase', sealed, relock: true } : c)) })
        await save()
      }
      const keys = { ...get().keys }
      delete keys[id]
      set({ keys })
    },

    async remember(id) {
      const key = get().keys[id]
      if (!key) throw new Error('Unlock this bot first.')
      const sealed = await seal(id, key, null)
      set({ connections: get().connections.map((c) => (c.id === id ? { ...c, storage: 'device', sealed, relock: false } : c)) })
      await save()
    },

    enterKey(id, key) {
      set({ keys: { ...get().keys, [id]: key.trim() } })
    },

    /** Forgets every key that needs a passphrase or was only typed in (device-sealed keys stay open). */
    lock() {
      const keys: Record<string, string> = {}
      for (const connection of get().connections) {
        const key = get().keys[connection.id]
        if (key && connection.storage === 'device') keys[connection.id] = key
      }
      set({ keys })
    },
  }
})

export function useActive() {
  return useConnections(
    useShallow((state) => {
      const connection = state.connections.find((c) => c.id === state.activeId) ?? null
      return { connection, key: connection ? (state.keys[connection.id] ?? null) : null }
    }),
  )
}
