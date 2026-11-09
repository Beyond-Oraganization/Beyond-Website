import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../state/db.ts'
import { queryClient, queryKey, rememberAnswer, restoreCache } from './bot.ts'
import type { CommandData } from './bot.ts'

// Answers kept on the device are kept already read, so only the app version that read them may put them back.
describe('the answers this device remembers for a bot', () => {
  const data = { result: { exitCode: 0 }, parsed: { ok: true, value: ['drcs'] }, at: Date.now(), roundTripMs: 5 } as unknown as CommandData<string[]>

  afterEach(async () => {
    queryClient.clear()
    await db.del('cache:bot-1:strategies')
  })

  it('come back after a restart of the same app version', async () => {
    await rememberAnswer('bot-1', 'strategies', ['strategies', '--json'], data)

    await restoreCache('bot-1')

    expect(queryClient.getQueryData(queryKey('bot-1', 'strategies', ['strategies', '--json']))).toEqual(data)
  })

  it('are dropped when an older app version read them, so a new field (position sizing) is not hidden', async () => {
    // What an app from before versioned answers kept: no version.
    await db.set('cache:bot-1:strategies', { key: queryKey('bot-1', 'strategies', ['strategies', '--json']), data })

    await restoreCache('bot-1')

    expect(queryClient.getQueryData(queryKey('bot-1', 'strategies', ['strategies', '--json']))).toBeUndefined()
  })
})
