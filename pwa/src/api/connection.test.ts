import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnections } from '../state/connections.ts'
import { queueFor, useHealth } from './bot.ts'

const BOT = 'https://bot.test:8443'
let n = 0
let id = ''
let answers: { status: number; body: Record<string, unknown> }[] = []
const sent: Record<string, string>[] = []

const result = (extra: Record<string, unknown> = {}) => ({ command: 'x', exitCode: 0, elapsedMs: 1, output: '', blocks: [], error: null, json: null, ...extra })

beforeEach(() => {
  id = `conn-${++n}`
  sent.length = 0
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Bot', url: BOT, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'key' }, tokens: {} })
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(init.headers as Record<string, string>)
    const next = answers.shift() ?? { status: 200, body: result() }
    return new Response(JSON.stringify(next.body), { status: next.status })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('this device’s connection to a bot', () => {
  it('keeps the token of the first login, and sends it with every later command', async () => {
    answers = [{ status: 200, body: result({ account: 'beyond', connection: 'token-1' }) }, { status: 200, body: result({ account: 'beyond' }) }]

    await queueFor(id).run(['login', 'beyond', '--password=secret-1'])
    await queueFor(id).run(['session', '--json'])

    expect(sent[0]!['X-BeyondBot-Connection']).toBeUndefined()
    expect(sent[1]!['X-BeyondBot-Connection']).toBe('token-1')
    expect(useHealth.getState().byId[id]?.account).toBe('beyond')
  })

  it('drops an expired token and says the bot needs a sign-in', async () => {
    useConnections.setState({ tokens: { [id]: 'old' } })
    answers = [{ status: 403, body: result({ exitCode: 2, error: { message: 'This connection has expired or is unknown; log in again.', hint: null } }) }]

    const outcome = await queueFor(id).run(['session', '--json'])

    expect(outcome.kind).toBe('expired')
    expect(useConnections.getState().tokens[id]).toBeUndefined()
    expect(useHealth.getState().byId[id]?.signedOut).toBe(true)
  })

  it('an answer acting on an account means the bot is signed in again', async () => {
    useHealth.getState().report(id, { kind: 'signedOut', command: 'session --json', account: null })
    answers = [{ status: 200, body: result({ account: 'roman' }) }]

    await queueFor(id).run(['accounts', '--json'])

    expect(useHealth.getState().byId[id]).toMatchObject({ signedOut: false, account: 'roman' })
  })
})
