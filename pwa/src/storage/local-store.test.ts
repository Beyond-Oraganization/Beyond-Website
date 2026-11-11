import { afterEach, describe, expect, it } from 'vitest'
import { bridgeStore, browserStore, keepsEverything, localStore, memoryStore, type DesktopBridge, type LocalStore, type StoreName } from './local-store.ts'

/** The storage port's contract, which every adapter keeps: what is set is got back, listed by prefix, and deleted. */
function contract(name: string, open: () => LocalStore) {
  describe(name, () => {
    it('gives back what was set, typed arrays included', async () => {
      const store = open()
      await store.set('copy|XAUUSD 1h|0', { close: Float64Array.of(1.5, 2.5) })

      // Compared by kind and values: a structured clone may come back from another realm (it does under jsdom).
      const got = await store.get<{ close: Float64Array }>('copy|XAUUSD 1h|0')
      expect([ArrayBuffer.isView(got?.close), Array.from(got?.close ?? [])]).toEqual([true, [1.5, 2.5]])
    })

    it('has nothing under a key never set', async () => {
      expect(await open().get('nothing')).toBeUndefined()
    })

    it('lists the keys that start with a prefix', async () => {
      const store = open()
      await Promise.all(['runs:a:1', 'runs:a:2', 'runs:b:1'].map((key) => store.set(key, 1)))

      expect((await store.keys('runs:a:')).sort()).toEqual(['runs:a:1', 'runs:a:2'])
      expect(await store.keys()).toHaveLength(3)
    })

    it('forgets a deleted key', async () => {
      const store = open()
      await store.set('k', 1)
      await store.delete('k')

      expect([await store.get('k'), await store.keys()]).toEqual([undefined, []])
    })
  })
}

/** A bridge as the desktop app's preload gives it: values cross by structured clone, into one table per store. */
function fakeBridge(): DesktopBridge {
  const tables = new Map<StoreName, Map<string, unknown>>()
  const table = (store: StoreName) => tables.get(store) ?? tables.set(store, new Map()).get(store)!
  return {
    storage: 'sqlite',
    get: async (store, key) => (table(store).has(key) ? structuredClone(table(store).get(key)) : null),
    set: async (store, key, value) => void table(store).set(key, structuredClone(value)),
    delete: async (store, key) => void table(store).delete(key),
    keys: async (store, prefix) => [...table(store).keys()].filter((key) => key.startsWith(prefix)),
  }
}

contract('the memory store', memoryStore)
contract('the desktop app’s SQLite store, through its bridge', () => bridgeStore(fakeBridge(), 'app'))

describe('choosing the store', () => {
  afterEach(() => {
    delete window.beyondBotDesktop
  })

  it('keeps the app’s data and the candle copies apart in the desktop app', async () => {
    const bridge = fakeBridge()
    await bridgeStore(bridge, 'app').set('k', 'app')
    await bridgeStore(bridge, 'candles').set('k', 'candles')

    expect([await bridgeStore(bridge, 'app').get('k'), await bridgeStore(bridge, 'candles').get('k')]).toEqual(['app', 'candles'])
  })

  it('keeps everything only inside the desktop app', () => {
    expect(keepsEverything()).toBe(false)
    window.beyondBotDesktop = fakeBridge()
    expect(keepsEverything()).toBe(true)
  })

  it('keeps what must not leave the page (the device key) out of the desktop app’s bridge', async () => {
    const bridge = fakeBridge()
    window.beyondBotDesktop = bridge
    await browserStore('app').set('device-key', 'a non-extractable key')

    expect(await bridge.keys('app', '')).toEqual([])
    expect(await browserStore('app').get('device-key')).toBe('a non-extractable key')
  })

  it('falls back to memory where the device has no IndexedDB', async () => {
    await localStore('app').set('k', 1)

    expect(await localStore('app').get('k')).toBe(1)
  })
})
