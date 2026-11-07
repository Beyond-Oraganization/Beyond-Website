import { beforeEach, describe, expect, it } from 'vitest'
import { useConnections } from './connections.ts'

const KEY = 'k'.repeat(48)
const PASS = 'correct horse battery'
const reload = async () => {
  // A reload: memory is gone, only what the device stored comes back.
  useConnections.setState({ keys: {}, loaded: false })
  await useConnections.getState().load()
}
const connection = (id: string) => useConnections.getState().connections.find((c) => c.id === id)!

beforeEach(async () => {
  for (const c of useConnections.getState().connections) await useConnections.getState().remove(c.id)
})

describe('remember me and locking a bot', () => {
  it('remember me keeps the key with the device key, so the bot opens after a reload without a passphrase', async () => {
    const { id } = await useConnections.getState().add({ name: 'Bot', url: 'https://bot.test:8443', key: KEY, storage: 'device' })

    await reload()

    expect(useConnections.getState().keys[id]).toBe(KEY)
  })

  it('locking a remembered bot seals its key under a passphrase, and it stays locked after a reload', async () => {
    const { id } = await useConnections.getState().add({ name: 'Bot', url: 'https://bot.test:8443', key: KEY, storage: 'device' })

    await useConnections.getState().lockWith(id, PASS)
    expect(useConnections.getState().keys[id]).toBeUndefined()
    await reload()

    expect(useConnections.getState().keys[id]).toBeUndefined()
    expect(connection(id)).toMatchObject({ storage: 'passphrase', relock: true })
  })

  it('unlocking a locked remembered bot remembers it again', async () => {
    const { id } = await useConnections.getState().add({ name: 'Bot', url: 'https://bot.test:8443', key: KEY, storage: 'device' })
    await useConnections.getState().lockWith(id, PASS)

    await useConnections.getState().unlock(id, PASS)
    await reload()

    expect(useConnections.getState().keys[id]).toBe(KEY)
    expect(connection(id)).toMatchObject({ storage: 'device', relock: false })
  })

  it('a bot kept with a passphrase can be switched to remember me while it is open', async () => {
    const { id } = await useConnections.getState().add({ name: 'Bot', url: 'https://bot.test:8443', key: KEY, storage: 'passphrase', passphrase: PASS })

    await useConnections.getState().remember(id)
    await reload()

    expect(useConnections.getState().keys[id]).toBe(KEY)
  })

  it('locking a bot kept with a passphrase only forgets the key', async () => {
    const { id } = await useConnections.getState().add({ name: 'Bot', url: 'https://bot.test:8443', key: KEY, storage: 'passphrase', passphrase: PASS })

    await useConnections.getState().lockWith(id, null)

    expect(useConnections.getState().keys[id]).toBeUndefined()
    expect(connection(id)).toMatchObject({ storage: 'passphrase' })
    await useConnections.getState().unlock(id, PASS)
    expect(useConnections.getState().keys[id]).toBe(KEY)
  })
})
