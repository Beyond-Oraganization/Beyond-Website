#!/usr/bin/env node
// The mock bot's HTTP side: the same contract as the real `beyondbot serve` (Api/CommandApi.cs, CommandRunner.cs).
// POST / with a Bearer key (401 otherwise), a body of at most 4,096 bytes (413), a command line or {"command"} or
// {"args"}; 400 for refused commands; one command at a time; CORS only for the listed origins (preflight without a
// key); a client that disconnects cancels its own command.
//
//   node mock-bot/server.mjs [--port 8443] [--speed 60] [--signed-out] [--ordering-bug] [--add-delay 3500]
//   MOCK_BOT_KEY (default below), MOCK_BOT_ORIGINS ("*" = any localhost origin, or a comma list)
//
// Test control (no key, only with --control): POST /__mock/reset, /__mock/advance?ms=3600000, /__mock/config
import http from 'node:http'
import { createBot } from './bot.mjs'

export const DEFAULT_KEY = 'mock-bot-key-0123456789abcdef0123456789abcdef'
const MAX_BODY = 4096
const TERMINAL_ONLY = new Set(['run', 'serve', 'ui', 'shell', 'exit', 'quit'])
const WATCHABLE = new Set(['session', 'balance', 'positions'])
const SECRET = ['--password', '--new-password', '--credential']

const split = (line) => [...line.matchAll(/"[^"]*"|[^\s]+/g)].map((m) => m[0].replace(/^"+|"+$/g, '')).filter(Boolean)
const normalize = (args) => (args.length === 1 && (args[0] === 'help' || args[0] === '?') ? ['--help'] : args)
const isWatch = (a) => a === '-w' || a === '--watch' || a.startsWith('--watch=') || a.startsWith('--watch:')

export function refusal(args) {
  if (!args.length) return { message: "Send a command, e.g. 'market list'.", hint: "'help' lists the commands." }
  if (TERMINAL_ONLY.has(args[0].toLowerCase())) return { message: `'${args[0]}' only works in a terminal on the server.`, hint: null }
  if (WATCHABLE.has(args[0].toLowerCase()) && args.some(isWatch)) return { message: '--watch never ends, so it does not work over the API.', hint: "Ask for 'session --json' as often as you need." }
  return null
}

export function describe(args) {
  const hide = (o, v) => (o === '--credential' && v.indexOf('=') > 0 ? v.slice(0, v.indexOf('=') + 1) + '***' : '***')
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const inline = SECRET.find((o) => a.length > o.length && a.startsWith(o) && (a[o.length] === '=' || a[o.length] === ':'))
    if (SECRET.includes(a) && i + 1 < args.length) out.push(a, hide(a, args[++i]))
    else if (inline) out.push(a.slice(0, inline.length + 1) + hide(inline, a.slice(inline.length + 1)))
    else out.push(a)
  }
  return out.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
}

const refused = (command, error) => ({ command, exitCode: 2, elapsedMs: 0, output: '', blocks: [], error, json: null, ok: false })

export function startServer({ port = 8443, key = DEFAULT_KEY, origins = '*', control = false, log = false, botOptions = {} } = {}) {
  let bot = createBot(botOptions)
  let gate = Promise.resolve()
  const allowed = (origin) => {
    if (!origin) return false
    if (origins === '*') return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    return origins.split(',').map((o) => o.trim()).includes(origin)
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    if (allowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    const url = new URL(req.url, 'http://mock')

    if (control && url.pathname.startsWith('/__mock/')) {
      res.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/__mock/reset') {
        bot.stop()
        const given = Object.fromEntries(url.searchParams)
        const flag = (name) => (name in given ? given[name] === '1' || given[name] === 'true' : botOptions[name])
        const number = (name) => (name in given ? Number(given[name]) : botOptions[name])
        bot = createBot({
          ...botOptions,
          signedIn: flag('signedIn') ?? true,
          trading: flag('trading') ?? true,
          orderingBug: flag('orderingBug') ?? false,
          databaseDown: flag('databaseDown') ?? false,
          addDelayMs: number('addDelayMs'),
          speed: number('speed'),
          seed: number('seed'),
        })
      } else if (url.pathname === '/__mock/advance') bot.advance(Number(url.searchParams.get('ms') ?? 3600000))
      else if (url.pathname === '/__mock/config') {
        if (url.searchParams.has('orderingBug')) bot.state.orderingBug = url.searchParams.get('orderingBug') === '1'
        if (url.searchParams.has('databaseDown')) bot.state.databaseDown = url.searchParams.get('databaseDown') === '1'
      }
      return res.end(JSON.stringify({ ok: true, now: new Date(bot.now()).toISOString() }))
    }

    if (req.method === 'OPTIONS') {
      // A browser's preflight carries no key; only allowed origins get CORS headers.
      if (allowed(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'POST')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      }
      res.statusCode = 204
      return res.end()
    }

    const auth = String(req.headers.authorization ?? '')
    if (!/^Bearer /i.test(auth) || auth.slice(7).trim() !== key) {
      res.statusCode = 401
      res.setHeader('WWW-Authenticate', 'Bearer')
      return res.end()
    }
    if (req.method !== 'POST' || url.pathname !== '/') {
      res.statusCode = 405
      return res.end()
    }

    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) tooLarge = true
      else chunks.push(chunk)
    })
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (tooLarge) {
        res.statusCode = 413
        return res.end()
      }
      const body = Buffer.concat(chunks).toString('utf8')
      let args
      if (/application\/json/i.test(req.headers['content-type'] ?? '')) {
        try {
          const value = JSON.parse(body)
          if (Array.isArray(value.args) && value.command == null && value.args.every((a) => typeof a === 'string')) args = value.args
          else if (typeof value.command === 'string' && value.args == null) args = split(value.command)
          else throw new Error('give either "command" (a string) or "args" (an array of strings).')
        } catch (error) {
          res.statusCode = 400
          return res.end(JSON.stringify(refused('', { message: `The body is not a command: ${error.message}`, hint: 'Send {"command": "market list"} or {"args": ["market", "list"]}.' })))
        }
      } else args = split(body)
      args = normalize(args)
      const no = refusal(args)
      if (no) {
        res.statusCode = 400
        return res.end(JSON.stringify(refused(describe(args), no)))
      }

      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      const run = gate.then(async () => {
        if (controller.signal.aborted) return null
        const started = performance.now()
        const result = await bot.run(args, { signal: controller.signal })
        return { result, elapsedMs: Math.round(performance.now() - started) }
      })
      gate = run.catch(() => {})
      const done = await run
      if (!done) return
      const { result, elapsedMs } = done
      const answer = { command: describe(args), exitCode: result.exitCode, elapsedMs, output: result.output, blocks: result.blocks, error: result.error, json: result.json ?? null, ok: result.exitCode === 0 }
      if (log) console.log(`API: ${answer.command} → exit code ${answer.exitCode} in ${elapsedMs} ms`)
      if (!res.writableEnded) res.end(JSON.stringify(answer))
    })
  })

  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, key, bot: () => bot, close: () => new Promise((done) => { bot.stop(); server.close(done) }) })),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const value = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const running = await startServer({
    port: Number(value('--port', process.env.MOCK_BOT_PORT ?? 8443)),
    key: process.env.MOCK_BOT_KEY ?? DEFAULT_KEY,
    origins: process.env.MOCK_BOT_ORIGINS ?? '*',
    control: argv.includes('--control'),
    log: !argv.includes('--quiet'),
    botOptions: {
      speed: Number(value('--speed', process.env.MOCK_BOT_SPEED ?? 1)),
      signedIn: !argv.includes('--signed-out'),
      orderingBug: argv.includes('--ordering-bug'),
      addDelayMs: Number(value('--add-delay', 3500)),
      start: value('--now', null) ? Date.parse(value('--now', null)) : undefined,
    },
  })
  console.log(`Mock Beyond Bot on http://127.0.0.1:${running.port}/  key: ${running.key}`)
}
