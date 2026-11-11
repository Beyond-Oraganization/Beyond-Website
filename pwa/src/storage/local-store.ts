import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval'

/**
 * Where the app keeps things on this device, behind one small port. In a browser or on a phone it is IndexedDB; in
 * the desktop app (the Electron wrapper in `desktop/`) it is a SQLite file, reached through the wrapper's bridge.
 * Values are anything the structured clone keeps: objects, arrays, typed arrays.
 */
export interface LocalStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** The keys that start with `prefix` (every key without one), in no particular order. */
  keys(prefix?: string): Promise<string[]>
}

/** The stores the app keeps: its own data, and the candle copies (a cache of the bot's candles). */
export type StoreName = 'app' | 'candles'

/** What the desktop app's preload script gives the page: four operations on its SQLite file, nothing else. */
export type DesktopBridge = {
  storage: 'sqlite'
  get(store: StoreName, key: string): Promise<unknown>
  set(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  keys(store: StoreName, prefix: string): Promise<string[]>
}

declare global {
  interface Window {
    beyondBotDesktop?: DesktopBridge
  }
}

/** The desktop app's bridge, when the app runs inside it. */
export const desktopBridge = (): DesktopBridge | null => (typeof window !== 'undefined' ? (window.beyondBotDesktop ?? null) : null)

/** True inside the desktop app, whose database keeps every run and every scenario: nothing is dropped to save room. */
export const keepsEverything = () => desktopBridge() != null

export function memoryStore(): LocalStore {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return values.get(key) as T | undefined
    },
    async set(key, value) {
      values.set(key, value)
    },
    async delete(key) {
      values.delete(key)
    },
    async keys(prefix = '') {
      return [...values.keys()].filter((key) => key.startsWith(prefix))
    },
  }
}

export function indexedDbStore(database: string, table: string): LocalStore {
  let store: UseStore | null = null
  const idb = () => (store ??= createStore(database, table))
  return {
    get: <T>(key: string) => get<T>(key, idb()),
    set: (key, value) => set(key, value, idb()),
    delete: (key) => del(key, idb()),
    async keys(prefix = '') {
      return ((await keys(idb())) as unknown[]).filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
    },
  }
}

export function bridgeStore(bridge: DesktopBridge, name: StoreName): LocalStore {
  return {
    get: async <T>(key: string) => ((await bridge.get(name, key)) ?? undefined) as T | undefined,
    set: (key, value) => bridge.set(name, key, value),
    delete: (key) => bridge.delete(name, key),
    keys: (prefix = '') => bridge.keys(name, prefix),
  }
}

/** The IndexedDB database and table each store has always used, so a browser keeps what it already stored. */
const BROWSER: Record<StoreName, [database: string, table: string]> = { app: ['beyond-bot', 'kv'], candles: ['beyond-bot-candles', 'chunks'] }

const opened = new Map<StoreName, LocalStore>()
const inBrowser = new Map<StoreName, LocalStore>()

/**
 * The browser's own store `name`, even inside the desktop app: for values that must not leave the page, such as a
 * non-extractable CryptoKey, which IndexedDB keeps as it is and which no bridge can carry.
 */
export function browserStore(name: StoreName): LocalStore {
  let store = inBrowser.get(name)
  if (!store) {
    store = typeof indexedDB !== 'undefined' ? indexedDbStore(...BROWSER[name]) : memoryStore()
    inBrowser.set(name, store)
  }
  return store
}

/**
 * The store `name` on this device: SQLite inside the desktop app, IndexedDB in a browser, and memory where neither
 * exists (tests, some private modes), which forgets on reload.
 */
export function localStore(name: StoreName): LocalStore {
  let store = opened.get(name)
  if (!store) {
    const bridge = desktopBridge()
    store = bridge ? bridgeStore(bridge, name) : typeof indexedDB !== 'undefined' ? indexedDbStore(...BROWSER[name]) : memoryStore()
    opened.set(name, store)
  }
  return store
}
