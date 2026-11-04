import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandQueue } from './queue.ts'
import { runCommand } from './client.ts'

const answer = (args: string[]) =>
  new Response(JSON.stringify({ command: args.join(' '), exitCode: 0, ok: true, elapsedMs: 1, output: '', blocks: [], error: null, json: null }), { status: 200 })

describe('CommandQueue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('runs one command at a time, user actions before reads and polls', async () => {
    const order: string[] = []
    const releases: (() => void)[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const { args } = JSON.parse(String(init.body)) as { args: string[] }
      order.push(args.join(' '))
      return new Promise<Response>((resolve) => releases.push(() => resolve(answer(args))))
    })
    const queue = new CommandQueue(() => ({ url: 'https://bot.example:8443', key: 'k'.repeat(32) }))
    const first = queue.run(['market', 'list'], { priority: 'view' })
    const poll = queue.run(['session', '--json'], { priority: 'poll' })
    const view = queue.run(['strategies'], { priority: 'view' })
    const action = queue.run(['orders', 'close', '1', '--yes'], { priority: 'interactive' })
    await vi.waitFor(() => expect(releases.length).toBe(1))
    expect(queue.busy()?.command).toBe('market list')
    for (let i = 0; i < 4; i++) {
      releases.shift()!()
      await vi.waitFor(() => expect(releases.length + i).toBeGreaterThanOrEqual(Math.min(i + 1, 3)))
    }
    await Promise.all([first, poll, view, action])
    expect(order).toEqual(['market list', 'orders close 1 --yes', 'strategies', 'session --json'])
    expect(queue.busy()).toBeNull()
  })

  it('shares identical reads', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls++
      return answer((JSON.parse(String(init.body)) as { args: string[] }).args)
    })
    const queue = new CommandQueue(() => ({ url: 'https://bot.example:8443', key: 'k'.repeat(32) }))
    const [a, b] = await Promise.all([queue.run(['session', '--json'], { priority: 'poll' }), queue.run(['session', '--json'], { priority: 'view' })])
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  it('cancels a waiting action without sending it', async () => {
    let release!: () => void
    const sent: string[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const { args } = JSON.parse(String(init.body)) as { args: string[] }
      sent.push(args.join(' '))
      return new Promise<Response>((resolve) => (release = () => resolve(answer(args))))
    })
    const queue = new CommandQueue(() => ({ url: 'https://bot.example:8443', key: 'k'.repeat(32) }))
    const busy = queue.run(['market', 'add', 'XAUUSD', '1h'])
    const controller = new AbortController()
    const waiting = queue.run(['orders', 'clear', '--yes'], { signal: controller.signal })
    controller.abort()
    expect(await waiting).toEqual({ kind: 'cancelled' })
    await vi.waitFor(() => expect(sent.length).toBe(1))
    release()
    await busy
    expect(sent).toEqual(['market add XAUUSD 1h'])
  })
})

describe('runCommand', () => {
  afterEach(() => vi.unstubAllGlobals())
  const target = { url: 'https://bot.example:8443', key: 'k'.repeat(32) }

  it('sends the arguments as JSON with the key', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer(['status']))
    vi.stubGlobal('fetch', fetch)
    const outcome = await runCommand(target, ['status'])
    expect(outcome.kind).toBe('ok')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://bot.example:8443/')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${'k'.repeat(32)}`, 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ args: ['status'] })
  })

  it.each([
    [401, null, 'unauthorized'],
    [413, null, 'tooLarge'],
    [200, { exitCode: 1, blocks: [], error: { message: 'x', hint: null } }, 'failed'],
    [200, { exitCode: 3, blocks: [], error: { message: 'You need to log in first.', hint: null } }, 'signedOut'],
    [400, { exitCode: 2, blocks: [], error: { message: 'refused', hint: null } }, 'usage'],
    [200, { exitCode: 130, blocks: [], error: null }, 'cancelled'],
    [500, { exitCode: 0, blocks: [] }, 'badResponse'],
  ])('maps HTTP %i to %s', async (status, body, kind) => {
    vi.stubGlobal('fetch', async () => new Response(body ? JSON.stringify(body) : null, { status }))
    expect((await runCommand(target, ['market', 'list'])).kind).toBe(kind)
  })

  it('reports a network failure as unreachable and never sends a refused command', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetch)
    expect((await runCommand(target, ['status'])).kind).toBe('unreachable')
    expect((await runCommand(target, ['ui'])).kind).toBe('usage')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
