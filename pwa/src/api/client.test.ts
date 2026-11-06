import { afterEach, describe, expect, it, vi } from 'vitest'
import { readResult, runCommand } from './client.ts'

const ok = (extra: Record<string, unknown> = {}) => ({
  command: 'status',
  exitCode: 0,
  elapsedMs: 3,
  output: '',
  blocks: [],
  error: null,
  json: null,
  ...extra,
})

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('the bot connection (Api/ApiConnections.cs)', () => {
  it('sends the connection token and the picked account as headers', async () => {
    const fetch = answer(200, ok())

    await runCommand({ url: 'https://bot.test:8443', key: 'k', connection: 'token-1', account: 'beyond' }, ['balance'])

    const headers = fetch.mock.calls[0]![1].headers as Record<string, string>
    expect(headers['X-BeyondBot-Connection']).toBe('token-1')
    expect(headers['X-BeyondBot-Account']).toBe('beyond')
  })

  it('sends neither header before the first login', async () => {
    const fetch = answer(200, ok())

    await runCommand({ url: 'https://bot.test:8443', key: 'k' }, ['status'])

    const headers = fetch.mock.calls[0]![1].headers as Record<string, string>
    expect(Object.keys(headers)).not.toContain('X-BeyondBot-Connection')
    expect(Object.keys(headers)).not.toContain('X-BeyondBot-Account')
  })

  it('reads a 403 as an expired connection, with the bot’s reason', async () => {
    answer(403, ok({ exitCode: 2, error: { message: 'This connection has expired or is unknown; log in again.', hint: null } }))

    const outcome = await runCommand({ url: 'https://bot.test:8443', key: 'k', connection: 'old' }, ['session', '--json'])

    expect(outcome.kind).toBe('expired')
    expect('result' in outcome && outcome.result.error?.message).toContain('log in again')
  })

  it('keeps the account the command ran on and the token a first login answered with', () => {
    const result = readResult(ok({ account: 'beyond', connection: 'token-1' }))

    expect(result.account).toBe('beyond')
    expect(result.connection).toBe('token-1')
    expect(readResult(ok()).account).toBeNull()
  })
})
