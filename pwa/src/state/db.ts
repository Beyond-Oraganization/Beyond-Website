import { localStore } from '../storage/local-store.ts'

/**
 * The app's own data on this device (`localStore('app')`: IndexedDB database "beyond-bot" in a browser, the SQLite
 * file in the desktop app). When storing fails (storage full or blocked) a value stays in memory for this visit, so
 * the app still works and simply forgets on reload.
 */
const memory = new Map<string, unknown>()
const store = () => localStore('app')

export const db = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      return await store().get<T>(key)
    } catch {
      return memory.get(key) as T | undefined
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    memory.set(key, value)
    try {
      await store().set(key, value)
    } catch {
      // storage full or blocked: the value stays in memory for this visit
    }
  },
  async del(key: string): Promise<void> {
    memory.delete(key)
    try {
      await store().delete(key)
    } catch {
      // ignore
    }
  },
  /** Every key/value pair whose key starts with this prefix. */
  async prefixed<T>(prefix: string): Promise<[string, T][]> {
    try {
      const keys = await store().keys(prefix)
      return (await Promise.all(keys.map(async (key) => [key, await store().get<T>(key)] as [string, T | undefined]))).filter((entry): entry is [string, T] => entry[1] !== undefined)
    } catch {
      return [...memory.entries()].filter(([key]) => key.startsWith(prefix)) as [string, T][]
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
