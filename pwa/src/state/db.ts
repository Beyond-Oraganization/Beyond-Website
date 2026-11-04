import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval'

/**
 * The app's storage on this device: IndexedDB database "beyond-bot". Without IndexedDB (tests, some private
 * modes) it falls back to memory, so the app still works and simply forgets on reload.
 */
let store: UseStore | null = null
const memory = new Map<string, unknown>()
const hasIdb = () => typeof indexedDB !== 'undefined'

function idb(): UseStore {
  store ??= createStore('beyond-bot', 'kv')
  return store
}

export const db = {
  async get<T>(key: string): Promise<T | undefined> {
    if (!hasIdb()) return memory.get(key) as T | undefined
    try {
      return await get<T>(key, idb())
    } catch {
      return memory.get(key) as T | undefined
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    memory.set(key, value)
    if (!hasIdb()) return
    try {
      await set(key, value, idb())
    } catch {
      // storage full or blocked: the value stays in memory for this visit
    }
  },
  async del(key: string): Promise<void> {
    memory.delete(key)
    if (!hasIdb()) return
    try {
      await del(key, idb())
    } catch {
      // ignore
    }
  },
  /** Every key/value pair whose key starts with this prefix. */
  async prefixed<T>(prefix: string): Promise<[string, T][]> {
    if (!hasIdb()) return [...memory.entries()].filter(([key]) => key.startsWith(prefix)) as [string, T][]
    try {
      return ((await entries(idb())) as [string, T][]).filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
    } catch {
      return []
    }
  },
  async delPrefixed(prefix: string): Promise<void> {
    for (const [key] of await db.prefixed(prefix)) await db.del(key)
  },
}

/** Asks the browser not to evict the stored connection under storage pressure (installed apps usually get it). */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
