#!/usr/bin/env node
// Records a real bot's answers as test fixtures, so the parsers are checked against what the bot really prints
// (src/api/parse/parsers.test.ts reads every file in src/api/fixtures/recorded/).
//
//   BEYONDBOT_URL=http://127.0.0.1:8443 BEYONDBOT_API_KEY_FILE=~/beyondbot-api-key npm run record-fixtures [-- --all]
//
// Only commands that change nothing are sent. With --all it also asks for indicators, a signal and a backtest of
// the market being traded (or the first stored one): those read the market into the bot's memory, and bot 2.0.0
// then fails its session view while two or more markets are in memory, so the default leaves them out.
//
// The answers are redacted before they are written: the login, the broker account id and IPv4 addresses become
// placeholders. Read the files before committing them all the same.
//
// For a bot with a self-signed certificate, let Node trust it: NODE_EXTRA_CA_CERTS=/path/to/beyondbot.crt.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const url = (process.env.BEYONDBOT_URL ?? 'http://127.0.0.1:8443').replace(/\/$/, '')
const keyFile = process.env.BEYONDBOT_API_KEY_FILE?.replace(/^~(?=\/)/, homedir())
const key = (process.env.BEYONDBOT_API_KEY ?? (keyFile ? await readFile(keyFile, 'utf8') : '')).trim()
const all = process.argv.includes('--all')
const out = fileURLToPath(new URL('../src/api/fixtures/recorded/', import.meta.url))

if (key.length < 32) {
  console.error('Give the API key: BEYONDBOT_API_KEY_FILE=<file> (or BEYONDBOT_API_KEY). It has at least 32 characters.')
  process.exit(2)
}

async function ask(args) {
  const response = await fetch(`${url}/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  }).catch((error) => {
    throw new Error(`The bot at ${url} cannot be reached (${error.cause?.code ?? error.message}).`)
  })
  if (response.status === 401) throw new Error('The bot refused the API key.')
  if (!response.ok && response.status !== 400) throw new Error(`The bot answered HTTP ${response.status}.`)
  return response.json()
}

const grid = (answer, label) => {
  const rows = (blocks) => blocks.flatMap((b) => (b.type === 'grid' ? b.rows : b.type === 'section' ? rows(b.blocks) : []))
  return rows(answer.blocks ?? []).find((row) => row[0] === label)?.[1] ?? null
}
const table = (answer) => {
  const find = (blocks) => blocks.flatMap((b) => (b.type === 'table' ? [b] : b.type === 'section' ? find(b.blocks) : []))
  return find(answer.blocks ?? [])[0] ?? null
}

const recorded = []
async function record(name, args) {
  const answer = await ask(args)
  recorded.push({ name, args, answer })
  console.log(`${answer.ok ? '✓' : '⚠'} ${args.join(' ')} → exit code ${answer.exitCode} in ${answer.elapsedMs} ms`)
  return answer
}

const status = await record('status', ['status'])
const markets = await record('market-list', ['market', 'list'])
await record('strategies', ['strategies'])
const session = await record('session', ['session', '--json'])
await record('orders', ['orders', 'list'])
await record('orders-broker', ['orders', 'list', '--broker'])

const INTERVALS = { OneMinute: '1m', ThreeMinutes: '3m', FiveMinutes: '5m', FifteenMinutes: '15m', ThirtyMinutes: '30m', OneHour: '1h', FourHours: '4h', TwelveHours: '12h', OneDay: '1d', OneWeek: '1w', OneMonth: '1M' }
const traded = session.json?.strategies?.[0]?.market
const stored = table(markets)?.rows?.[0]
const market = traded ? [traded.symbol, INTERVALS[traded.interval] ?? traded.interval] : stored ? [stored[0], stored[1]] : null

if (market) {
  await record('candles', ['candles', 'show', ...market, '--last', '30'])
  await record('candles-oldest', ['candles', 'oldest', ...market])
  if (all) {
    await record('indicators', ['indicators', 'show', ...market, '--last', '10'])
    await record('signal', ['signal', 'drcs', '--symbol', market[0], '--interval', market[1], '-d'])
    await record('backtest', ['backtest', 'drcs', '--symbol', market[0], '--interval', market[1], '-d'])
  }
} else console.log('No stored market: candles, indicators, signal and backtest are left out.')

// Redaction: the bot's login, the broker account id, and every IPv4 address.
const secrets = [
  [grid(status, 'User'), 'demo'],
  [session.json?.account?.accountId, '5012345'],
].filter(([value]) => typeof value === 'string' && value.length > 1 && !['demo', '5012345', 'not logged in'].includes(value))
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function redact(text) {
  let clean = text
  for (const [secret, placeholder] of secrets) clean = clean.replace(new RegExp(`\\b${escape(secret)}\\b`, 'g'), placeholder)
  clean = clean.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (ip === '127.0.0.1' ? ip : '192.0.2.10'))
  if (clean.includes(key)) throw new Error('An answer contains the API key; nothing was written.')
  return clean
}

await mkdir(out, { recursive: true })
const version = grid(status, 'Version')?.split(',')[0] ?? 'unknown'
for (const [index, { name, args, answer }] of recorded.entries()) {
  const file = `${String(index + 1).padStart(2, '0')}-${name}.json`
  await writeFile(`${out}${file}`, redact(JSON.stringify({ args, botVersion: version, answer }, null, 2)) + '\n')
}
console.log(`\nWrote ${recorded.length} answers of bot ${version} to src/api/fixtures/recorded/. Read them before committing.`)
