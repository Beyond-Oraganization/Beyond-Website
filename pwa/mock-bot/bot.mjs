// A simulated Beyond Bot for development, tests and screenshots. It answers commands the way the real bot's
// HTTP command API does (Api/CommandRunner.cs, Api/OutputRecorder.cs): the same blocks, table columns, grid rows,
// texts, exit codes and error hints, with markets, a broker account, strategies and orders kept in memory.
import * as F from './format.mjs'

export const INTERVALS = [
  ['1m', 'OneMinute', 'M1', 60e3, true], ['3m', 'ThreeMinutes', 'M3', 180e3, true], ['5m', 'FiveMinutes', 'M5', 300e3, true],
  ['15m', 'FifteenMinutes', 'M15', 900e3, true], ['30m', 'ThirtyMinutes', 'M30', 1800e3, true], ['1h', 'OneHour', 'H1', 3600e3, true],
  ['2h', 'TwoHours', null, 7200e3, false], ['4h', 'FourHours', 'H4', 14400e3, true], ['6h', 'SixHours', null, 21600e3, false],
  ['8h', 'EightHours', null, 28800e3, false], ['12h', 'TwelveHours', 'H12', 43200e3, true], ['1d', 'OneDay', 'D1', 86400e3, true],
  ['3d', 'ThreeDays', null, 259200e3, false], ['1w', 'OneWeek', 'W1', 604800e3, true], ['1M', 'OneMonth', 'MN1', 2592000e3, true],
].map(([code, name, alias, ms, ctrader]) => ({ code, name, alias, ms, ctrader }))

const parseInterval = (text) => {
  const value = String(text ?? '').trim()
  return INTERVALS.find((i) => i.code === value) ?? INTERVALS.find((i) => i.name.toLowerCase() === value.toLowerCase() || i.alias?.toLowerCase() === value.toLowerCase()) ?? null
}
const intervalError = (text) =>
  new Exit(1, `Unknown interval '${text}'. Use one of: ${INTERVALS.map((i) => i.code).join(', ')} (or a name such as OneHour).`, null)

const WEEKEND = new Set(['XAUUSD', 'XAGUSD', 'XAUTUSDT', 'XAGUSDT', 'EURPLN', 'EURUSD'])
const isWeekend = (ms) => [0, 6].includes(new Date(ms).getUTCDay())
const HISTORY_START = Date.UTC(2019, 0, 1)
const HELP_HINT = 'Run the command with --help to see its arguments and options.'
const BROKER_HINT = "Check the connection with 'status'; the log has the details."
const SYMBOLS = {
  XAUUSD: { price: 2650, vol: 0.0032, quote: 'USD' },
  XAGUSD: { price: 31.2, vol: 0.006, quote: 'USD' },
  EURUSD: { price: 1.0852, vol: 0.0011, quote: 'USD' },
  EURPLN: { price: 4.312, vol: 0.0009, quote: 'PLN' },
  GBPUSD: { price: 1.2714, vol: 0.0012, quote: 'USD' },
  USDJPY: { price: 151.2, vol: 0.0013, quote: 'JPY' },
}
const DRCS = {
  name: 'drcs',
  title: 'Double Red Cross',
  description:
    'Builds an adaptive envelope of bands spaced by ATR × deviation below and above the EMA: lower 1 and upper 1 are nearest the center, up to moving-count on each side. Its rules trade on candles crossing those bands, and each open spends half of the balance. By default it buys when a candle opens below lower 1 and closes above it, and closes the newest long when a candle crosses back down through it.',
  market: { symbol: 'XAUUSD', interval: '1h' },
  parameters: [
    { name: 'depth', description: 'Lookback of the EMA and ATR the envelope is built from', default: 23, min: 1, max: 500 },
    { name: 'deviation', description: 'ATR multiplier between neighbouring bands', default: 1, min: 1, max: 20 },
    { name: 'moving-count', description: 'Number of bands on each side of the center', default: 2, min: 1, max: 10 },
  ],
  // Strategies/Drcs: the rules it trades by when none are given, and how a rule is written (Strategies/Rules).
  rules: ['open long on cross up lower 1', 'close long on cross down lower 1'],
  syntax: 'open|close long|short on cross up|down lower|upper N',
  balanceShare: 0.5,
}

/** A command that ended with this exit code, message and hint (Cli/ErrorReporter.cs). */
export class Exit extends Error {
  constructor(code, message, hint = null) {
    super(message)
    this.code = code
    this.hint = hint
  }
}

function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (value, digits) => Number(value.toFixed(digits))
const digitsFor = (price) => (price >= 1000 ? 2 : price >= 10 ? 3 : 5)

// ---------- output, as the recorder turns it into blocks ----------
class Out {
  blocks = []
  text(line) {
    this.blocks.push({ type: 'text', text: line })
  }
  table(columns, rows) {
    this.blocks.push({ type: 'table', title: null, columns, rows })
  }
  grid(rows) {
    this.blocks.push({ type: 'grid', rows })
  }
  section(title, build) {
    const inner = new Out()
    build(inner)
    this.blocks.push({ type: 'section', title, blocks: merge(inner.blocks) })
  }
}

function merge(blocks) {
  const merged = []
  let lines = []
  const flush = () => {
    if (lines.length) merged.push({ type: 'text', text: lines.join('\n') })
    lines = []
  }
  for (const block of blocks) {
    if (block.type === 'text') {
      const value = block.text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').trimEnd()
      if (value.trim()) lines.push(value)
    } else {
      flush()
      merged.push(block)
    }
  }
  flush()
  return merged
}

/** The plain text a terminal would show (an approximation of Spectre's layout). */
export function render(blocks, width = 140) {
  const out = []
  for (const block of blocks) {
    if (block.type === 'text') out.push(block.text)
    if (block.type === 'grid') {
      const w = Math.max(...block.rows.map((row) => row[0].length))
      for (const row of block.rows) out.push(`${row[0].padEnd(w + 2)}${row.slice(1).join(' ')}`)
    }
    if (block.type === 'table') {
      const widths = block.columns.map((column, i) => Math.max(column.length, ...block.rows.map((row) => (row[i] ?? '').length)))
      const line = (cells) => '  ' + cells.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('   ')
      out.push(line(block.columns), ' ' + '─'.repeat(Math.min(width - 2, widths.reduce((a, b) => a + b + 3, 0))), ...block.rows.map(line))
    }
    if (block.type === 'section') {
      const inner = render(block.blocks, width - 4).split('\n')
      const w = Math.min(width - 4, Math.max(block.title.length + 2, ...inner.map((l) => l.length)))
      out.push(`╭─${block.title}${'─'.repeat(Math.max(0, w - block.title.length))}╮`, ...inner.map((l) => `│ ${l.padEnd(w)} │`), `╰${'─'.repeat(w + 2)}╯`)
    }
  }
  return out.join('\n') + (out.length ? '\n' : '')
}

// ---------- arguments, roughly as Spectre reads them ----------
function readArgs(argv, spec = {}) {
  const pos = []
  const opt = {}
  const options = Object.entries(spec)
  const find = (name) =>
    options.find(([long, o]) => long.toLowerCase() === name.toLowerCase() || o.alias === name)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg)) {
      const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : arg.includes(':') && arg.startsWith('--') ? [arg.slice(0, arg.indexOf(':')), arg.slice(arg.indexOf(':') + 1)] : [arg, undefined]
      const found = find(name)
      if (!found) throw new Exit(2, `Unknown option '${name.replace(/^-+/, '')}'.`, HELP_HINT)
      const [long, o] = found
      const key = long.replace(/^-+/, '')
      if (o.value) {
        const value = inline ?? argv[++i]
        if (value === undefined) throw new Exit(2, `Option '${key}' is defined but no value has been provided.`, HELP_HINT)
        if (o.multiple) (opt[key] ??= []).push(value)
        else opt[key] = value
      } else opt[key] = true
    } else pos.push(arg)
  }
  return { pos, opt }
}

export function createBot(options = {}) {
  const speed = options.speed ?? 1
  let offset = 0
  const realStart = Date.now()
  const start = options.start ?? Date.now()
  const now = () => start + (Date.now() - realStart) * speed + offset
  const rand = prng(options.seed ?? 7)
  const startedAt = now() - 3 * 86400e3 - 4 * 3600e3

  // The registered trading accounts (Accounts/AccountRegistry.cs): one simulated broker account stands behind all of them.
  const users = new Map([['demo', { login: 'demo', password: 'demo-password', credentials: {}, broker: 'CTrader', mode: 'Demo' }]])
  const s = {
    /** The account the running command acts on (set by run()). */
    user: null,
    /** The open accounts (Hosting/Logins.cs), by lower-cased login: { login, signedInAt }. */
    open: new Map(),
    /** The account a run without a connection acts on: the old single-login bot, for direct callers and tests. */
    startupUser: null,
    loginAt: null,
    account: { broker: 'cTrader', mode: 'Demo', accountId: '5012345', balance: 10000, currency: 'EUR', leverage: 30 },
    markets: new Map(),
    loaded: new Set(),
    positions: [],
    records: [],
    sessions: new Map(),
    stats: { startBalance: null, tradesOpened: 0, tradesClosed: 0, realizedProfit: 0, wins: 0, losses: 0 },
    nextOrder: 812345,
    orderingBug: options.orderingBug ?? false,
    databaseDown: options.databaseDown ?? false,
  }

  // ---------- candles ----------
  const keyOf = (symbol, code) => `${symbol} ${code}`
  const lastClosedOpen = (ms) => Math.floor(now() / ms) * ms - ms
  function step(symbol, previous, ms, r = rand) {
    const info = SYMBOLS[symbol] ?? { price: 100, vol: 0.004 }
    const sigma = info.vol * Math.sqrt(ms / 3600e3)
    const gauss = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())
    const pull = (info.price - previous) / info.price * 0.02
    const close = previous * Math.exp(gauss * sigma + pull)
    const d = digitsFor(info.price)
    const high = Math.max(previous, close) * (1 + r() * sigma * 0.6)
    const low = Math.min(previous, close) * (1 - r() * sigma * 0.6)
    return { open: round(previous, d), high: round(high, d), low: round(low, d), close: round(close, d), volume: Math.round(800 + r() * 4200) }
  }
  function extend(market, upTo) {
    const { symbol, interval } = market
    let last = market.candles.at(-1)
    let t = last ? last.openTime + interval.ms : upTo - (options.history ?? 1600) * interval.ms
    let added = 0
    let price = last ? last.close : SYMBOLS[symbol]?.price ?? 100
    for (; t <= upTo; t += interval.ms) {
      if (WEEKEND.has(symbol) && interval.ms <= 86400e3 && isWeekend(t)) continue
      const c = step(symbol, price, interval.ms)
      market.candles.push({ openTime: t, closeTime: t + interval.ms, ...c })
      price = c.close
      added++
    }
    return added
  }
  function createMarket(symbol, interval, history) {
    const market = { symbol, interval, candles: [] }
    const saved = options.history
    if (history) options.history = history
    extend(market, lastClosedOpen(interval.ms))
    options.history = saved
    s.markets.set(keyOf(symbol, interval.code), market)
    return market
  }
  const marketOrFail = (symbol, interval) => {
    const market = s.markets.get(keyOf(symbol, interval.code))
    if (!market || !market.candles.length) throw new Exit(1, `${symbol} ${interval.code} is not set up.`, `Add it with: market add ${symbol} ${interval.code}`)
    return market
  }

  // ---------- indicators and the strategy (Indicators/Indicator.cs, Strategies/Drcs) ----------
  function indicators(candles, depth) {
    const ema = []
    const rma = []
    const atr = []
    const w = 2 / (depth + 1)
    candles.forEach((c, i) => {
      ema.push(c.close * w + (i ? ema[i - 1] : c.open) * (1 - w))
      rma.push(i ? (rma[i - 1] * (depth - 1) + c.close) / depth : c.close)
      const range = c.high - c.low
      atr.push(i ? (atr[i - 1] * (depth - 1) + range) / depth : range)
    })
    return { ema, rma, atr }
  }
  const params = (input = {}) => {
    const values = Object.fromEntries(DRCS.parameters.map((p) => [p.name, p.default]))
    for (const [name, value] of Object.entries(input)) {
      const p = DRCS.parameters.find((q) => q.name.toLowerCase() === name.toLowerCase())
      if (!p) throw new Exit(1, `drcs has no parameter ${name}. Parameters: ${DRCS.parameters.map((q) => q.name).join(', ')}.`)
      if (value < p.min || value > p.max) throw new Exit(1, `${p.name} must be between ${p.min} and ${p.max}; got ${F.plain(value)}.`)
      if (!Number.isInteger(value)) throw new Exit(1, `${p.name} must be a whole number; got ${F.plain(value)}.`)
      values[p.name] = value
    }
    return values
  }
  // Strategies/Rules/TradingRule.cs, LineCross.cs and EnvelopeBand.cs: "open|close long|short on cross up|down lower|upper N".
  const RULE_FORM = 'open|close long|short on'
  const CONDITION_SYNTAX = 'cross up|down lower|upper N'
  function parseRule(text, values) {
    const words = text.trim().split(/\s+/)
    const [action, side, on, ...rest] = words
    if (words.length < 4 || !/^(open|close)$/i.test(action) || !/^(long|short)$/i.test(side) || !/^on$/i.test(on))
      throw new Exit(1, `'${text.trim()}' is not a rule: write ${RULE_FORM} CONDITION.`)
    const condition = rest.join(' ')
    const [keyword, direction, ...line] = rest
    if (rest.length < 3 || !/^cross$/i.test(keyword) || !/^(up|down)$/i.test(direction))
      throw new Exit(1, `Rule '${text.trim()}': '${condition}' is not a condition: write ${CONDITION_SYNTAX}.`)
    const band = line.join(' ')
    if (line.length !== 2 || !/^(lower|upper)$/i.test(line[0]) || !/^\d+$/.test(line[1]))
      throw new Exit(1, `Rule '${text.trim()}': '${band}' is not a band: write lower N or upper N.`)
    const number = Number(line[1])
    const name = `${line[0].toLowerCase()} ${number}`
    if (number < 1 || number > values['moving-count'])
      throw new Exit(1, `Rule '${text.trim()}': ${name} is not a band of the envelope: it has bands 1 to ${values['moving-count']} on each side.`)
    return { action: action.toLowerCase(), side: side.toLowerCase(), up: direction.toLowerCase() === 'up', lower: line[0].toLowerCase() === 'lower', number, line: name, text: `${action.toLowerCase()} ${side.toLowerCase()} on cross ${direction.toLowerCase()} ${name}` }
  }
  const rulesOf = (texts, values) => {
    const split = texts.flatMap((text) => text.split(';')).map((text) => text.trim()).filter(Boolean)
    return (split.length ? split : DRCS.rules).map((text) => parseRule(text, values))
  }
  const describeParams = (p, rules) => `${Object.entries(p).map(([k, v]) => `${k}=${F.plain(v)}`).join(' ')}, rules: ${rules.map((r) => r.text).join('; ')}`
  const p5 = (v) => v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 5 })
  // Strategies/Rules/RuleStrategy.cs: the first rule whose condition holds gives the signal.
  function explain(candles, i, p, rules, cache) {
    const { ema, atr } = cache ?? indicators(candles, p.depth)
    const c = candles[i]
    const where = (v, level) => (v > level ? 'above' : v < level ? 'below' : 'exactly on')
    const checks = rules.map((rule) => {
      const level = ema[i] + (rule.lower ? -1 : 1) * atr[i] * p.deviation * rule.number
      const met = rule.up ? c.open < level && c.close > level : c.open > level && c.close < level
      const reason = met
        ? `opened ${where(c.open, level)} ${rule.line} (${p5(level)}) and closed ${where(c.close, level)} it`
        : `opened ${where(c.open, level)} and closed ${where(c.close, level)} ${rule.line} (${p5(level)})`
      return { rule, level, met, reason }
    })
    const fired = checks.find((check) => check.met)
    const side = (rule) => (rule.side === 'long' ? 'Buy' : 'Sell')
    const signal = !fired
      ? { action: 'None', side: 'None', balanceShare: 0 }
      : fired.rule.action === 'open'
        ? { action: 'Open', side: side(fired.rule), balanceShare: DRCS.balanceShare }
        : { action: 'Close', side: side(fired.rule), balanceShare: 0 }
    const reason = fired ? `${fired.rule.text[0].toUpperCase()}${fired.rule.text.slice(1)}: ${fired.reason}.` : `No rule fired: ${[...new Set(checks.map((check) => check.reason))].join('; ')}.`
    const levels = [...new Map(checks.map((check) => [check.rule.line, { name: check.rule.line, value: round(check.level, 6), isLevel: true }])).values()]
    const values = [
      { name: 'open', value: c.open, isLevel: false },
      { name: 'close', value: c.close, isLevel: false },
      { name: `EMA(${p.depth})`, value: round(ema[i], 6), isLevel: false },
      { name: `ATR(${p.depth})`, value: round(atr[i], 6), isLevel: false },
      ...levels,
    ]
    return { signal, reason, values }
  }
  const positionSide = (side) => (side === 'Buy' ? 'long' : 'short')
  const signalText = (signal) =>
    signal.action === 'Open' ? `open ${positionSide(signal.side)} (${Math.round(signal.balanceShare * 100)} % of balance)` : signal.action === 'Close' ? `close ${positionSide(signal.side)}` : 'none'

  // ---------- account ----------
  const symbolInfo = (symbol) => SYMBOLS[symbol] ?? { price: 100, quote: 'USD' }
  const lastClose = (symbol) => {
    const markets = [...s.markets.values()].filter((m) => m.symbol === symbol && m.candles.length)
    return markets.length ? markets.sort((a, b) => a.interval.ms - b.interval.ms)[0].candles.at(-1).close : symbolInfo(symbol).price
  }
  const quote = (symbol) => {
    const base = lastClose(symbol)
    const wobble = Math.sin(now() / 47000) * symbolInfo(symbol).vol * 0.35 + Math.sin(now() / 7300) * symbolInfo(symbol).vol * 0.1
    return round(base * (1 + wobble), digitsFor(base))
  }
  const toAccount = (amount, currency) => {
    if (currency === s.account.currency) return { value: amount, converted: false, ok: true }
    if (currency === 'USD') return { value: amount / quote('EURUSD'), converted: true, ok: true }
    if (currency === 'PLN') return { value: amount / quote('EURPLN'), converted: true, ok: true }
    return { value: null, converted: false, ok: false }
  }
  const profitOf = (position, price) => (price - position.price) * (position.side === 'Buy' ? 1 : -1) * position.quantity
  function closePosition(position, strategy) {
    const price = quote(position.symbol)
    const raw = profitOf(position, price)
    const { value } = toAccount(raw, symbolInfo(position.symbol).quote)
    const pnl = round(value ?? raw, 2)
    s.account.balance = round(s.account.balance + pnl, 2)
    s.positions = s.positions.filter((p) => p !== position)
    s.stats.realizedProfit = round(s.stats.realizedProfit + pnl, 2)
    if (pnl > 0) s.stats.wins++
    if (pnl < 0) s.stats.losses++
    if (strategy) s.stats.tradesClosed++
    const record = s.records.find((r) => r.orderId === position.orderId)
    if (record) record.status = 'None'
    return { price, pnl }
  }
  function open(symbol, side, quantity, strategy) {
    const price = quote(symbol)
    const order = { orderId: String(s.nextOrder++), symbol, quantity, price, status: 'Filled', type: 'Market', side, createdAt: now(), strategy }
    s.positions.push(order)
    s.records.push({ ...order })
    if (strategy) s.stats.tradesOpened++
    return order
  }

  // ---------- trading sessions (Trading/TradingSession.cs) ----------
  const nextBoundary = (ms) => (Math.floor(now() / ms) + 1) * ms
  function tick(session, preview = false) {
    const market = s.markets.get(session.key)
    const started = now()
    const base = { market: { symbol: market.symbol, interval: market.interval.name }, strategy: 'drcs', time: new Date(started).toISOString(), trade: null, error: null }
    if (!preview && WEEKEND.has(market.symbol) && isWeekend(started)) {
      return (session.lastTick = { ...base, outcome: 'MarketClosed', candle: null, insight: null, candlesAdded: 0, elapsed: F.span(1), nextTickAt: new Date(nextBoundary(market.interval.ms)).toISOString() })
    }
    const added = extend(market, lastClosedOpen(market.interval.ms))
    const i = market.candles.length - 1
    const candle = market.candles[i]
    const json = { openTime: new Date(candle.openTime).toISOString(), closeTime: new Date(candle.closeTime).toISOString(), open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, isFlat: candle.high === candle.low, range: round(candle.high - candle.low, 6) }
    const nextTickAt = new Date(nextBoundary(market.interval.ms)).toISOString()
    if (!preview && candle.openTime <= session.evaluated) {
      session.ticks++
      return (session.lastTick = { ...base, outcome: 'NoNewCandle', candle: json, insight: null, candlesAdded: added, elapsed: F.span(4), nextTickAt })
    }
    const insight = explain(market.candles, i, session.params, session.rules)
    let trade = null
    if (!preview && insight.signal.action === 'Open') {
      const quantity = round((s.account.balance * insight.signal.balanceShare) / candle.close / 10, 2)
      const order = open(market.symbol, insight.signal.side, Math.max(quantity, 0.01), 'drcs')
      session.positions.push(order.orderId)
      trade = { market: base.market, strategy: 'drcs', action: 'Opened', order: orderJson(order), time: base.time }
      session.trades++
    } else if (!preview && insight.signal.action === 'Close') {
      // Trading/OrderExecutor.cs: the newest position this session opened on that side.
      const mine = session.positions.map((id) => s.positions.find((p) => p.orderId === id)).filter((p) => p && p.side === insight.signal.side)
      const position = mine.at(-1)
      if (position) session.positions = session.positions.filter((id) => id !== position.orderId)
      if (position) {
        const { price } = closePosition(position, 'drcs')
        trade = { market: base.market, strategy: 'drcs', action: 'Closed', order: orderJson({ ...position, price, status: 'None' }), time: base.time }
        session.trades++
      }
    }
    session.evaluated = candle.openTime
    if (!preview) session.ticks++
    return (session.lastTick = { ...base, outcome: preview ? 'Preview' : 'Evaluated', candle: json, insight, candlesAdded: added, trade, elapsed: F.span(3 + Math.round(rand() * 20)), nextTickAt })
  }
  function runTicks() {
    for (const session of s.sessions.values()) {
      const market = s.markets.get(session.key)
      if (market && now() >= session.nextTickAt) {
        tick(session)
        session.nextTickAt = nextBoundary(market.interval.ms)
      }
    }
  }
  const timer = options.ticking === false ? null : setInterval(runTicks, 1000)
  timer?.unref?.()

  // ---------- views ----------
  const orderJson = (o) => ({ orderId: o.orderId, symbol: o.symbol, quantity: o.quantity, price: o.price, status: o.status, type: o.type, side: o.side, createdAt: new Date(o.createdAt).toISOString() })
  function snapshot() {
    const t = now()
    if (s.orderingBug && new Set([...s.loaded, ...[...s.sessions.values()].map((x) => x.key)]).size >= 2)
      throw new Exit(1, 'Failed to compare two elements in the array.', null)
    const positions = s.positions.map((p) => {
      const current = quote(p.symbol)
      const raw = profitOf(p, current)
      const converted = toAccount(raw, symbolInfo(p.symbol).quote)
      return {
        id: p.orderId, symbol: p.symbol, side: p.side, quantity: p.quantity, entryPrice: p.price, currentPrice: current,
        unrealizedProfit: round(converted.ok ? converted.value : raw, 2), profitCurrency: converted.ok ? s.account.currency : symbolInfo(p.symbol).quote,
        inAccountCurrency: converted.ok, isConverted: converted.converted, isPending: false, openedAt: new Date(p.createdAt).toISOString(),
      }
    })
    const unrealized = round(positions.filter((p) => p.inAccountCurrency).reduce((sum, p) => sum + p.unrealizedProfit, 0), 2)
    const exposure = round(s.positions.reduce((sum, p) => sum + (toAccount(p.quantity * quote(p.symbol), symbolInfo(p.symbol).quote).value ?? 0), 0), 2)
    const change = s.stats.startBalance == null ? null : round(s.account.balance - s.stats.startBalance, 2)
    const freshness = [...new Set([...s.loaded, ...[...s.sessions.values()].map((x) => x.key)])].sort().map((key) => {
      const m = s.markets.get(key)
      const newest = m?.candles.at(-1)
      return { market: { symbol: m.symbol, interval: m.interval.name }, candles: m.candles.length, newestOpenTime: newest ? new Date(newest.openTime).toISOString() : null, age: newest ? F.span(t - newest.closeTime) : null }
    })
    return {
      time: new Date(t).toISOString(),
      account: {
        broker: s.account.broker, mode: s.account.mode, accountId: s.account.accountId, balance: s.account.balance, currency: s.account.currency,
        equity: round(s.account.balance + unrealized, 2), equityIsComplete: positions.every((p) => p.inAccountCurrency), unrealizedProfit: unrealized,
        changeSinceStart: change, changeSinceStartPercent: change == null || !s.stats.startBalance ? null : round((change / s.stats.startBalance) * 100, 4),
        leverage: s.account.leverage, exposure, updatedAt: new Date(t - 2000).toISOString(), error: null,
      },
      positions,
      stats: {
        user: s.user, startedAt: new Date(s.loginAt).toISOString(), uptime: F.span(t - s.loginAt), startBalance: s.stats.startBalance,
        tradesOpened: s.stats.tradesOpened, tradesClosed: s.stats.tradesClosed, realizedProfit: s.stats.realizedProfit, wins: s.stats.wins, losses: s.stats.losses,
      },
      strategies: [...s.sessions.values()].sort((a, b) => a.key.localeCompare(b.key) || a.startedAt - b.startedAt).map((x) => {
        const m = s.markets.get(x.key)
        return {
          name: x.name, market: { symbol: m.symbol, interval: m.interval.name }, strategy: 'drcs', parameters: x.params, rules: x.rules.map((r) => r.text), startedAt: new Date(x.startedAt).toISOString(),
          ticks: x.ticks, trades: x.trades, lastTick: x.lastTick, lastError: x.lastError, lastErrorAt: x.lastErrorAt, nextTickAt: new Date(nextBoundary(m.interval.ms)).toISOString(),
        }
      }),
      system: {
        version: '2.0.0', processUptime: F.span(t - startedAt),
        broker: { isConnected: true, connectedSince: new Date(s.loginAt).toISOString(), lastLatency: F.span(38 + rand() * 20), lastError: null },
        database: s.databaseDown
          ? { isConnected: false, server: 'localhost:3306', database: 'BeyondBotDB', schemaVersion: 0, serverVersion: null, latency: F.span(1), error: 'Cannot reach MySQL at localhost:3306.' }
          : { isConnected: true, server: 'localhost:3306', database: 'BeyondBotDB', schemaVersion: 2, serverVersion: '8.0.39', latency: F.span(3.2), error: null },
        databaseCheckedAt: new Date(t - 12000).toISOString(), markets: freshness, managedMemoryBytes: 61_865_984, workingSetBytes: 187_695_104,
        logPath: `/opt/beyondbot/logs/beyondbot-${new Date(startedAt).toISOString().slice(0, 10).replace(/-/g, '')}.log`,
      },
    }
  }

  // ---------- commands ----------
  const requireLogin = () => {
    if (!s.user) throw new Exit(3, 'You need to log in first.', "Run 'login' (or 'register' to create an account).")
  }
  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Exit(130, 'Cancelled.', null))
      }, { once: true })
    })
  const strategyInput = (argv, extra = {}) => {
    const { pos, opt } = readArgs(argv, { '--symbol': { alias: '-s', value: true }, '--interval': { alias: '-i', value: true }, '--set': { alias: '-p', value: true, multiple: true }, '--rule': { alias: '-r', value: true, multiple: true }, '--defaults': { alias: '-d' }, ...extra })
    const name = pos[0] ?? 'drcs'
    if (name.toLowerCase() !== 'drcs') throw new Exit(1, `Unknown strategy '${name}'. Available: drcs (Double Red Cross).`)
    const values = {}
    for (const assignment of opt.set ?? []) {
      const at = assignment.indexOf('=')
      const value = Number(assignment.slice(at + 1).replace(/,/g, ''))
      if (at <= 0 || Number.isNaN(value)) throw new Exit(1, `'${assignment}' is not a NAME=VALUE parameter, e.g. --set depth=23.`)
      values[assignment.slice(0, at).trim()] = value
    }
    const interval = parseInterval(opt.interval ?? DRCS.market.interval)
    if (!interval) throw intervalError(opt.interval)
    const resolved = params(values)
    return { symbol: String(opt.symbol ?? DRCS.market.symbol).trim().toUpperCase(), interval, params: resolved, rules: rulesOf(opt.rule ?? [], resolved), opt }
  }
  const insightPanel = (o, market, tickReport) =>
    o.section(`drcs on ${market.symbol} ${market.interval.code}`, (x) =>
      x.grid([
        ['Candle', tickReport.candle ? `${F.time(Date.parse(tickReport.candle.openTime))} UTC → ${F.time(Date.parse(tickReport.candle.closeTime))} UTC` : '–'],
        ...tickReport.insight.values.map((v) => [v.name, F.price(v.value)]),
        ['Signal', signalText(tickReport.insight.signal)],
        ['Why', tickReport.insight.reason],
      ]),
    )
  const strategiesSection = (o, list, t) => {
    if (!list.length) return o.section('Strategies', (x) => x.text('No strategy is trading. Start one with: trading start drcs'))
    o.section(`Strategies (${list.length} running)`, (x) =>
      x.table(['Market', 'Strategy', 'Parameters and rules', 'Running', 'Ticks', 'Trades', 'Last signal', 'Next tick', 'Last error'], list.map((st) => {
        const m = s.markets.get(st.key)
        const next = nextBoundary(m.interval.ms)
        const last = st.lastTick?.insight ? signalText(st.lastTick.insight.signal) : st.lastTick?.outcome ?? '–'
        const parameters = Object.entries(st.params).map(([k, v]) => `${k}=${F.plain(v)}`).join(' ')
        return [`${m.symbol} ${m.interval.code}`, 'drcs', `${parameters}\n${st.rules.map((r) => r.text).join('\n')}`, F.duration((t - st.startedAt) / 1000), String(st.ticks), String(st.trades), last, `${F.clock(next)} (in ${F.duration((next - t) / 1000)})`, st.lastError ?? 'none']
      })),
    )
  }
  function sessionViews(o, section) {
    const snap = snapshot()
    const a = snap.account
    const show = (name) => !section || section === name
    if (show('account'))
      o.section('Account', (x) => {
        x.grid([
          ['Broker', `${a.broker} ${a.mode === 'Demo' ? 'DEMO' : 'LIVE'}  ${a.accountId ?? ''}`], ['Balance', F.money(a.balance, a.currency)],
          ['Equity', F.money(a.equity, a.currency) + (a.equityIsComplete ? '' : ' (excl. other-currency positions)')], ['Unrealized P/L', F.signedMoney(a.unrealizedProfit, a.currency)],
          ['Since session start', `${F.signedMoney(a.changeSinceStart, a.currency)} ${F.signedPercent(a.changeSinceStartPercent)}`], ['Leverage', a.leverage ? `1:${F.number(a.leverage)}` : '–'],
          ['Exposure', F.money(a.exposure, a.currency)],
        ])
        x.text(`updated ${F.clock(Date.parse(a.updatedAt))} UTC`)
      })
    if (show('stats'))
      o.section('Session', (x) =>
        x.grid([
          ['User', snap.stats.user ?? '–'], ['Started', `${F.time(Date.parse(snap.stats.startedAt))} UTC (${F.duration((Date.parse(snap.time) - Date.parse(snap.stats.startedAt)) / 1000)} ago)`],
          ['Start balance', F.money(snap.stats.startBalance, a.currency)], ['Trades', `${snap.stats.tradesOpened} opened, ${snap.stats.tradesClosed} closed`],
          ['Realized P/L', F.signedMoney(snap.stats.realizedProfit, a.currency)], ['Wins / losses', `${snap.stats.wins} / ${snap.stats.losses}`],
        ]),
      )
    if (show('positions')) {
      if (!snap.positions.length) o.section('Open positions', (x) => x.text('No open positions or pending orders.'))
      else
        o.section(`Open positions (${snap.positions.length})`, (x) => {
          x.table(['Symbol', 'Side', 'Size', 'Entry', 'Price', 'Unrealized P/L', 'Opened', 'Id'], snap.positions.map((p) => [p.symbol, p.side.toLowerCase(), F.number(p.quantity), F.price(p.entryPrice), F.price(p.currentPrice), F.signedMoney(p.unrealizedProfit, p.profitCurrency) + (p.isConverted ? ' ≈' : ''), F.time(Date.parse(p.openedAt)), p.id]))
          if (snap.positions.some((p) => p.isConverted)) x.text('≈ converted from the quote currency at current prices')
        })
    }
    if (show('strategies')) strategiesSection(o, [...s.sessions.values()], Date.parse(snap.time))
    if (show('system'))
      o.section('System', (x) =>
        x.grid([
          ['Broker', `connected 42 ms, since ${F.time(s.loginAt)} UTC`],
          ['Database', s.databaseDown ? 'unavailable (Cannot reach MySQL at localhost:3306.)' : 'connected 3 ms, BeyondBotDB@localhost:3306, schema v2, MySQL 8.0.39'],
          ['Market data', snap.system.markets.length ? snap.system.markets.map((m) => `${m.market.symbol} ${parseInterval(m.market.interval).code} (${F.duration((Date.parse(snap.time) - Date.parse(m.newestOpenTime)) / 1000)} old)`).join(', ') : 'none loaded'],
          ['Memory', `${F.bytes(snap.system.managedMemoryBytes)} managed, ${F.bytes(snap.system.workingSetBytes)} working set`],
          ['Version', `2.0.0, up ${F.duration((Date.parse(snap.time) - startedAt) / 1000)}`], ['Log', snap.system.logPath],
        ]),
      )
  }
  // Opens the account unless it is open (another connection may have it open, with its strategies).
  function signIn(o, login) {
    const user = users.get(login.toLowerCase())
    if (!s.open.has(login.toLowerCase())) {
      if (!s.open.size) {
        s.loginAt = now()
        s.stats = { startBalance: s.account.balance, tradesOpened: 0, tradesClosed: 0, realizedProfit: 0, wins: 0, losses: 0 }
      }
      s.open.set(login.toLowerCase(), { login: user?.login ?? login, signedInAt: now() })
    }
    s.user = user?.login ?? login
    const mode = (user?.mode ?? 'Demo') === 'Live' ? 'LIVE' : 'DEMO'
    o.text(`Connecting to ${user?.broker ?? 'CTrader'} ${mode === 'LIVE' ? 'LIVE' : 'Demo'}…`)
    o.text(`✓ Welcome, ${s.user}.`)
    o.text(`  ${user?.broker === 'Bybit' ? 'Bybit' : 'cTrader'} ${mode} account ${s.account.accountId}: balance ${F.money(s.account.balance, s.account.currency)}, ${s.positions.length} open position(s). Run session for details.`)
  }

  const describeAccount = (login, current) => {
    const user = users.get(login.toLowerCase())
    const open = s.open.get(login.toLowerCase())
    return {
      login: open?.login ?? login, broker: user?.broker ?? 'CTrader', mode: user?.mode ?? 'Demo', current, connected: true,
      accountId: s.account.accountId, balance: s.account.balance, currency: s.account.currency, strategies: s.sessions.size,
      signedInAt: new Date(open?.signedInAt ?? now()).toISOString(), error: null,
    }
  }

  const commands = {
    status: (o, argv) => {
      const { opt } = readArgs(argv, { '--json': {} })
      if (opt.json) {
        const accounts = (ctx.connection ? ctx.connection.accounts : [...s.open.values()].map((a) => a.login)).filter((l) => s.open.has(l.toLowerCase()))
        const value = { version: '2.0.0', startedAt: new Date(startedAt).toISOString(), databaseConnected: !s.databaseDown, schemaVersion: s.databaseDown ? 0 : 3,
          databaseError: s.databaseDown ? 'Cannot reach MySQL at localhost:3306.' : null, accounts: accounts.map((l) => describeAccount(l, l === s.user)) }
        o.text(JSON.stringify(value, null, 2))
        return s.databaseDown ? 1 : { json: value }
      }
      o.text('Checking…')
      o.section('Status', (x) =>
        x.grid([
          ['Version', `2.0.0, up ${F.duration((now() - startedAt) / 1000)}`],
          ['Database', s.databaseDown ? 'unavailable (Cannot reach MySQL at localhost:3306.)' : 'connected in 3 ms: BeyondBotDB@localhost:3306, schema v2'],
          ['User', s.user ?? 'not logged in'], ['Broker', s.user ? `connected to ${users.get(s.user.toLowerCase())?.broker === 'Bybit' ? 'Bybit' : 'cTrader'} ${users.get(s.user.toLowerCase())?.mode === 'Live' ? 'LIVE' : 'DEMO'}` : 'connects after login'],
          ['Trading', `${s.sessions.size} strategy session(s)`], ['Credentials', '/var/lib/beyondbot/Credentials'], ['Log', snapshotLog()],
        ]),
      )
      if (s.databaseDown) return 1
    },
    session: (o, argv, kind) => {
      const { pos, opt } = readArgs(argv, { '--json': {}, '--plain': {}, '--field': { value: true }, '--watch': { alias: '-w' } })
      requireLogin()
      const section = kind ?? pos[0]?.toLowerCase()
      if (section && !['account', 'positions', 'stats', 'strategies', 'system'].includes(section)) throw new Exit(1, `Unknown section '${pos[0]}'. Use account, positions, stats, strategies or system.`)
      if (opt.json) {
        const snap = snapshot()
        const value = section ? snap[section] : snap
        o.text(JSON.stringify(value, null, 2))
        return { json: value }
      }
      sessionViews(o, section)
    },
    balance: (o, argv) => commands.session(o, argv, 'account'),
    positions: (o, argv) => commands.session(o, argv, 'positions'),
    login: (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--password': { value: true } })
      const login = pos[0]
      if (opt.password != null && !login) throw new Exit(1, 'Give the login too: login <LOGIN> --password <PASSWORD>.')
      if (!login) throw new Exit(1, 'Login is required; pass it with the LOGIN argument.')
      if (opt.password == null) throw new Exit(1, 'Password is required; pass it with --password.')
      if (!/^[\w.-]+$/.test(login)) throw new Exit(1, "Login may only contain letters, digits, '.', '_' and '-'.")
      const user = users.get(login.toLowerCase())
      if (!user || user.password !== opt.password) throw new Exit(1, 'Invalid login or password.')
      signIn(o, user.login)
      if (ctx.connection) {
        if (!ctx.connection.accounts.includes(user.login)) ctx.connection.accounts.push(user.login)
        ctx.connection.current = user.login
        ctx.picked = null
        if (ctx.connection.accounts.length > 1)
          o.text(`  This connection holds ${ctx.connection.accounts.length} accounts; commands now act on ${user.login} ('accounts' lists them, 'use' switches).`)
      } else s.startupUser = user.login
    },
    // Lets go of an account; with --stop also stops its strategies and closes it (Cli/Commands/AccountCommands.cs).
    logout: (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--stop': {}, '--yes': { alias: '-y' } })
      const held = ctx.connection ? ctx.connection.accounts : s.startupUser ? [s.startupUser] : []
      const name = pos[0] ? held.find((l) => l.toLowerCase() === pos[0].toLowerCase()) : s.user
      if (pos[0] && !name) throw new Exit(1, `This connection is not signed in to '${pos[0]}'.`)
      if (!name) return o.text('Nobody is logged in.')
      const running = s.sessions.size
      if (opt.stop) {
        if (running && !opt.yes) throw new Exit(1, `${running} strategy session(s) of '${name}' are trading. Stop them and log out? Pass --yes to confirm without being asked.`)
        s.sessions.clear()
        s.open.delete(name.toLowerCase())
        o.text('Stopping…')
        o.text(`✓ Stopped and logged out ${name}.`)
      } else {
        o.text(`✓ Logged out ${name}.`)
        if (running) o.text(`  Its ${running} strategy session(s) keep trading. Log in again to see them, or stop them with: logout ${name} --stop`)
      }
      if (ctx.connection) {
        ctx.connection.accounts = ctx.connection.accounts.filter((l) => l !== name)
        if (ctx.connection.current === name) ctx.connection.current = ctx.connection.accounts.at(-1) ?? null
        if (ctx.picked === name) ctx.picked = null
        if (ctx.connection.current) o.text(`  Commands now act on ${ctx.connection.current}.`)
      } else if (s.startupUser === name) s.startupUser = null
    },
    use: (o, argv) => {
      const { pos } = readArgs(argv)
      const held = ctx.connection ? ctx.connection.accounts : s.startupUser ? [s.startupUser] : []
      const name = held.find((l) => l.toLowerCase() === String(pos[0] ?? '').toLowerCase())
      if (!name) throw new Exit(1, `This connection is not signed in to '${pos[0] ?? ''}'. Log in to it first: login ${pos[0] ?? ''}`)
      if (ctx.connection) ctx.connection.current = name
      ctx.picked = null
      s.user = name
      const user = users.get(name.toLowerCase())
      o.text(`✓ Commands now act on ${name} (${user?.broker ?? 'CTrader'} ${user?.mode === 'Live' ? 'LIVE' : 'DEMO'}).`)
    },
    accounts: (o, argv) => {
      const { opt } = readArgs(argv, { '--json': {} })
      const held = (ctx.connection ? ctx.connection.accounts : s.startupUser ? [s.startupUser] : []).filter((l) => s.open.has(l.toLowerCase()))
      const list = held.map((l) => describeAccount(l, l === s.user))
      if (opt.json) {
        o.text(JSON.stringify(list, null, 2))
        return { json: list }
      }
      if (!list.length) return o.text("This connection holds no trading account. Add one with 'login' (or 'register' to create one).")
      o.table(['', 'Login', 'Broker', 'Mode', 'Account', 'Balance', 'Strategies', 'Since'], list.map((a) => [a.current ? '▸' : '', a.login, a.broker, a.mode === 'Live' ? 'LIVE' : 'DEMO', a.accountId ?? '', F.money(a.balance, a.currency), String(a.strategies), F.time(Date.parse(a.signedInAt))]))
    },
    register: (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--password': { value: true }, '--credential': { value: true, multiple: true }, '--broker': { value: true }, '--mode': { value: true }, '--confirm-live': {} })
      const login = pos[0]
      const broker = { ctrader: 'CTrader', bybit: 'Bybit' }[String(opt.broker ?? 'ctrader').toLowerCase()]
      if (!broker) throw new Exit(1, `Unknown broker '${opt.broker}'. Use one of: CTrader, Bybit.`)
      const mode = { demo: 'Demo', live: 'Live' }[String(opt.mode ?? 'demo').toLowerCase()]
      if (!mode) throw new Exit(1, `Unknown mode '${opt.mode}'. Use Demo or Live.`)
      const fields = broker === 'Bybit' ? ['API_KEY', 'API_SECRET'] : ['CLIENT_ID', 'CLIENT_SECRET', 'ACCESS_TOKEN', 'REFRESH_TOKEN', 'ACCOUNT_ID']
      const credentials = {}
      for (const pair of opt.credential ?? []) {
        const at = pair.indexOf('=')
        if (at <= 0) throw new Exit(1, 'Write each credential as --credential KEY=VALUE, e.g. --credential CLIENT_ID=12345.')
        const key = pair.slice(0, at).toUpperCase()
        if (!['CLIENT_ID', 'CLIENT_SECRET', 'ACCESS_TOKEN', 'REFRESH_TOKEN', 'ACCOUNT_ID', 'API_KEY', 'API_SECRET'].includes(key))
          throw new Exit(1, `Unknown credential '${key}'. Use one of: CLIENT_ID, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN, ACCOUNT_ID, API_KEY, API_SECRET.`)
        if (key in credentials) throw new Exit(1, `--credential ${key} is given twice.`)
        credentials[key] = pair.slice(at + 1)
      }
      if (!login) throw new Exit(1, 'Choose a login is required; pass it with the LOGIN argument.')
      if (login.length < 3 || login.length > 64) throw new Exit(1, 'A login has 3 to 64 characters.')
      if (!/^[\w.-]+$/.test(login)) throw new Exit(1, "A login may only contain letters, digits, '.', '_' and '-'.")
      if (users.has(login.toLowerCase())) throw new Exit(1, `The login '${login}' is taken; choose another.`)
      if (opt.password == null) throw new Exit(1, 'Choose a password is required; pass it with --password.')
      if (opt.password.length < 8) throw new Exit(1, 'A password has at least 8 characters.')
      if (mode === 'Live' && !opt['confirm-live']) throw new Exit(1, `Register '${login}' as a LIVE ${broker} account? Its strategies trade real money. Pass --confirm-live to confirm without being asked.`)
      for (const key of Object.keys(credentials))
        if (!fields.includes(key)) throw new Exit(1, `${key} is a ${broker === 'Bybit' ? 'CTrader' : 'Bybit'} field; this account trades through ${broker}.`)
      const required = broker === 'Bybit' ? [['API_KEY', 'API key'], ['API_SECRET', 'API secret']] : [['CLIENT_ID', 'Client ID'], ['CLIENT_SECRET', 'Client secret'], ['ACCESS_TOKEN', 'Access token'], ['ACCOUNT_ID', 'Account ID']]
      for (const [key, label] of required)
        if (!credentials[key]) throw new Exit(1, `${label} is required; pass it with --credential ${key}=….`)
      if (broker === 'CTrader' && !/^\d+$/.test(credentials.ACCOUNT_ID)) throw new Exit(1, 'The account ID is a number.')
      users.set(login.toLowerCase(), { login, password: opt.password, credentials, broker, mode })
      o.text(`✓ Registered ${login} (${broker} ${mode === 'Live' ? 'LIVE' : 'DEMO'}); credentials encrypted in /var/lib/beyondbot/Credentials. Log in with: login ${login}`)
    },
    credentials: (o, argv) => {
      const { opt } = readArgs(argv, { '--password': { value: true }, '--new-password': { value: true }, '--credential': { value: true, multiple: true } })
      requireLogin()
      const user = users.get(s.user.toLowerCase())
      if (opt.password == null) throw new Exit(1, 'Current password is required; pass it with --password.')
      if (opt.password !== user.password) throw new Exit(1, 'Incorrect password.')
      if (opt['new-password'] === '') throw new Exit(1, 'The new password cannot be empty.')
      if (opt['new-password'] && opt['new-password'].length < 8) throw new Exit(1, 'A password has at least 8 characters.')
      if (opt['new-password']) user.password = opt['new-password']
      o.text('✓ Credentials saved.')
      if (opt['new-password'] && s.user === 'demo')
        o.text('⚠ The server signs in as demo at startup with its password file; put the new password there too (on a systemd install: /etc/beyondbot/password), or the next start stays signed out.')
      if (s.sessions.size) o.text('The account is trading or open on another connection, so it keeps its old credentials until it is next opened.')
      else signIn(o, s.user)
    },
    'market list': (o) => {
      if (!s.markets.size) return o.text('No markets yet. Add one with: market add XAUUSD 1h')
      const t = now()
      o.table(['Symbol', 'Interval', 'Candles', 'First', 'Newest', 'Age', 'Trading'], [...s.markets.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.interval.ms - b.interval.ms).map((m) => [
        m.symbol, m.interval.code, F.count(m.candles.length), F.time(m.candles[0]?.openTime), F.time(m.candles.at(-1)?.openTime),
        m.candles.length ? F.duration((t - m.candles.at(-1).closeTime) / 1000) : '–', [...s.sessions.values()].some((x) => x.key === keyOf(m.symbol, m.interval.code)) ? 'yes' : '',
      ]))
    },
    'market add': async (o, argv, _, signal) => {
      const { pos } = readArgs(argv)
      if (pos.length < 2) throw new Exit(2, `Command 'add' is missing required argument '${pos.length ? 'INTERVAL' : 'SYMBOL'}'.`, HELP_HINT)
      requireLogin()
      const symbol = pos[0].trim().toUpperCase()
      const interval = parseInterval(pos[1])
      if (!interval) throw intervalError(pos[1])
      if (!interval.ctrader) throw new Exit(1, `cTrader has no ${interval.code} candles. Use one of: ${INTERVALS.filter((i) => i.ctrader).map((i) => i.code).join(', ')}.`)
      if (!SYMBOLS[symbol]) throw new Exit(1, `Unknown cTrader symbol: ${symbol}`, BROKER_HINT)
      const startedAdd = Date.now()
      // Like the real download, candles are stored batch by batch: a cancelled download keeps what it stored.
      const existing = s.markets.get(keyOf(symbol, interval.code))
      const market = existing ?? createMarket(symbol, interval, 1200)
      const before = existing ? existing.candles.length : 0
      if (!existing) market.candles.splice(Math.ceil(market.candles.length / 3))
      await sleep(options.addDelayMs ?? 3500, signal)
      if (!existing) {
        const full = createMarket(symbol, interval, 1200)
        market.candles = full.candles
        s.markets.set(keyOf(symbol, interval.code), market)
      } else extend(market, lastClosedOpen(interval.ms))
      const added = market.candles.length - before
      o.text(`Downloading ${symbol} ${interval.code} since 2019-01-01: 100%`)
      o.text(`✓ ${symbol} ${interval.code}: stored ${F.count(added)} new candles in ${F.elapsed(Date.now() - startedAdd)}; the newest opened ${F.time(market.candles.at(-1).openTime)} UTC.`)
    },
    'market sync': (o, argv) => {
      const { pos } = readArgs(argv)
      requireLogin()
      if (pos[0] && !pos[1]) throw new Exit(1, `Give the interval too, e.g. market sync ${pos[0]} 1h.`)
      const list = pos[0] ? [marketOrFail(pos[0].toUpperCase(), parseInterval(pos[1]) ?? (() => { throw intervalError(pos[1]) })())] : [...s.markets.values()]
      o.text(pos[0] ? `Syncing ${pos[0]}…` : 'Syncing every market…')
      o.table(['Market', 'New candles', 'Newest candle', 'Took'], list.map((m) => {
        const added = extend(m, lastClosedOpen(m.interval.ms))
        return [`${m.symbol} ${m.interval.code}`, F.count(added), `${F.time(m.candles.at(-1)?.openTime)} UTC`, F.elapsed(40 + rand() * 300)]
      }))
    },
    'market remove': (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--yes': { alias: '-y' } })
      if (!pos[0]) throw new Exit(2, "Command 'remove' is missing required argument 'SYMBOL'.", HELP_HINT)
      const symbol = pos[0].toUpperCase()
      const interval = pos[1] ? parseInterval(pos[1]) : null
      if (pos[1] && !interval) throw intervalError(pos[1])
      const targets = [...s.markets.values()].filter((m) => m.symbol === symbol && (!interval || m.interval.code === interval.code))
      if (!targets.length) {
        o.text(`Nothing stored for ${pos[0]} ${pos[1] ?? ''}.`)
        return 1
      }
      if (targets.some((m) => [...s.sessions.values()].some((x) => x.key === keyOf(m.symbol, m.interval.code)))) throw new Exit(1, `That market is being traded. Stop it first with: trading stop ${symbol}`)
      const candles = targets.reduce((sum, m) => sum + m.candles.length, 0)
      if (!opt.yes) throw new Exit(1, `Delete ${targets.map((m) => `${m.symbol} ${m.interval.code}`).join(', ')} and its ${F.count(candles)} candles? Pass --yes to confirm without being asked.`)
      for (const m of targets) {
        s.markets.delete(keyOf(m.symbol, m.interval.code))
        s.loaded.delete(keyOf(m.symbol, m.interval.code))
      }
      o.text(`✓ Deleted ${F.count(candles)} candles.`)
    },
    'candles show': (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--last': { alias: '-n', value: true }, '--from': { value: true }, '--to': { value: true } })
      const symbol = (pos[0] ?? '').toUpperCase()
      const interval = parseInterval(pos[1])
      if (!interval) throw intervalError(pos[1])
      const market = s.markets.get(keyOf(symbol, interval.code))
      const from = opt.from ? Date.parse(opt.from.length <= 10 ? `${opt.from}T00:00:00Z` : `${opt.from.replace(/Z$/, '')}Z`) : null
      const to = opt.to ? Date.parse(opt.to.length <= 10 ? `${opt.to}T00:00:00Z` : `${opt.to.replace(/Z$/, '')}Z`) : null
      const last = Number(opt.last ?? 50)
      const candles = (market?.candles ?? []).filter((c) => (from == null || c.openTime >= from) && (to == null || c.openTime <= to)).slice(-last)
      if (!candles.length) return o.text(`No ${symbol} ${interval.code} candles stored${from != null || to != null ? ' in that range' : ''}.`)
      o.table(['Open (UTC)', 'Open', 'High', 'Low', 'Close', 'Volume'], candles.map((c) => [F.time(c.openTime), F.price(c.open), F.price(c.high), F.price(c.low), F.price(c.close), F.number(c.volume)]))
      o.text(`${candles.length} candles; --last, --from and --to choose others.`)
    },
    'candles oldest': (o, argv) => {
      const { pos } = readArgs(argv)
      requireLogin()
      const symbol = (pos[0] ?? '').toUpperCase()
      const interval = parseInterval(pos[1])
      if (!interval) throw intervalError(pos[1])
      if (!SYMBOLS[symbol]) throw new Exit(1, `Unknown cTrader symbol: ${symbol}`, BROKER_HINT)
      o.text(`Searching cTrader's history for the oldest ${symbol} ${interval.code} candle…`)
      o.text(`cTrader's oldest ${symbol} ${interval.code} candle opened ${F.time(HISTORY_START - 30 * 86400e3 + 23 * 3600e3)} UTC (close ${F.price(round(SYMBOLS[symbol].price * 0.49, digitsFor(SYMBOLS[symbol].price)))}).`)
    },
    'indicators show': (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--depth': { value: true }, '--last': { alias: '-n', value: true } })
      const symbol = (pos[0] ?? '').toUpperCase()
      const interval = parseInterval(pos[1])
      if (!interval) throw intervalError(pos[1])
      const market = marketOrFail(symbol, interval)
      s.loaded.add(keyOf(symbol, interval.code))
      const depth = Number(opt.depth ?? 23)
      const last = Number(opt.last ?? 20)
      const { ema, rma, atr } = indicators(market.candles, depth)
      const from = Math.max(0, market.candles.length - last)
      o.table(['Open (UTC)', 'Close', `EMA(${depth})`, `RMA(${depth})`, `ATR(${depth})`, 'EMA − ATR', 'EMA + ATR'], market.candles.slice(from).map((c, k) => {
        const i = from + k
        return [F.time(c.openTime), F.price(c.close), F.price(round(ema[i], 5)), F.price(round(rma[i], 5)), F.price(round(atr[i], 5)), F.price(round(ema[i] - atr[i], 5)), F.price(round(ema[i] + atr[i], 5))]
      }))
      o.text(`Computed over all ${F.count(market.candles.length)} stored candles in ${F.elapsed(8 + rand() * 30)}.`)
    },
    strategies: (o, argv) => {
      const { opt } = readArgs(argv, { '--json': {} })
      if (opt.json) {
        // Cli/Rendering/StrategyCatalogJson.cs
        const value = [{
          name: DRCS.name, title: DRCS.title, description: DRCS.description, symbol: DRCS.market.symbol, interval: DRCS.market.interval,
          parameters: DRCS.parameters.map((p) => ({ name: p.name, description: p.description, default: p.default, minimum: p.min, maximum: p.max, wholeNumber: true })),
          rules: { defaults: DRCS.rules, syntax: DRCS.syntax },
        }]
        o.text(JSON.stringify(value, null, 2))
        return { json: value }
      }
      o.section(`${DRCS.name} – ${DRCS.title}`, (x) => {
        x.text(DRCS.description)
        x.text(`Default market: ${DRCS.market.symbol} ${DRCS.market.interval}`)
        x.table(['Parameter', 'Default', 'Range', 'Meaning'], DRCS.parameters.map((p) => [p.name, F.plain(p.default), `${F.plain(p.min)}–${F.plain(p.max)}`, p.description]))
        x.text(`Default rules, tried in order (the first that fires gives the signal):\n${DRCS.rules.map((rule) => `  ${rule}`).join('\n')}`)
        x.text(`Write a rule: ${DRCS.syntax}`)
      })
      o.text('Set a parameter with --set NAME=VALUE and replace the rules with --rule, e.g. backtest drcs --set depth=30 --rule "open short on cross down upper 1" --rule "close short on cross up upper 1".')
    },
    signal: (o, argv) => {
      const input = strategyInput(argv)
      requireLogin()
      const market = marketOrFail(input.symbol, input.interval)
      s.loaded.add(keyOf(market.symbol, market.interval.code))
      o.text(`Syncing ${market.symbol} ${market.interval.code}…`)
      extend(market, lastClosedOpen(market.interval.ms))
      const report = { candle: candleJson(market.candles.at(-1)), insight: explain(market.candles, market.candles.length - 1, input.params, input.rules) }
      insightPanel(o, market, report)
      o.text(`${describeParams(input.params, input.rules)}; the next candle closes at ${F.hhmm(nextBoundary(market.interval.ms))} UTC.`)
    },
    backtest: (o, argv) => {
      const input = strategyInput(argv, { '--balance': { alias: '-b', value: true }, '--from': { value: true }, '--to': { value: true } })
      const market = marketOrFail(input.symbol, input.interval)
      s.loaded.add(keyOf(market.symbol, market.interval.code))
      o.text(`Reading ${market.symbol} ${market.interval.code} candles…`)
      const parseDate = (text) => Date.parse(text.length <= 10 ? `${text}T00:00:00Z` : `${text.replace(/Z$/, '')}Z`)
      const initial = Number(input.opt.balance ?? 1000)
      const startAt = input.opt.from ? parseDate(input.opt.from) : market.candles[0].openTime
      const endAt = input.opt.to ? parseDate(input.opt.to) : now()
      const report = backtestRun(market, input.params, input.rules, initial, startAt, endAt)
      o.section(`Backtest: drcs on ${market.symbol} ${market.interval.code}`, (x) =>
        x.grid([
          ['Period', `${F.time(startAt)} → ${F.time(endAt)} UTC, ${F.count(report.evaluated)} candles`],
          ['Balance', `${F.money(initial)} → ${F.money(report.balance)}`],
          ['Profit / loss', `${F.signedMoney(report.balance - initial)} ${F.signedPercent(((report.balance - initial) / initial) * 100)}`],
          ['Trades', `${report.closed} closed: ${report.won} won, ${report.lost} lost, win rate ${F.percent(report.closed ? (report.won / report.closed) * 100 : 0, 1)}`],
          ['Average per trade', F.signedMoney(report.closed ? (report.balance - initial) / report.closed : 0)],
          ['Best trade', `${F.signedMoney(report.maxProfit)} (${F.percent(report.maxProfitPercent)})`],
          ['Max drawdown', `${F.signedMoney(report.maxDrawdown)} (${F.percent(report.maxDrawdownPercent)})`],
          ...(report.open ? [['Still open', `${report.open} position(s), not counted in the balance`]] : []),
          ['Computed in', F.elapsed(60 + rand() * 80)],
        ]),
      )
      o.text(describeParams(input.params, input.rules))
    },
    'trading start': (o, argv) => {
      const input = strategyInput(argv, { '--live': {}, '--name': { alias: '-n', value: true } })
      requireLogin()
      if (users.get(s.user.toLowerCase())?.mode === 'Live' && !input.opt.live)
        throw new Exit(1, `'${s.user}' is a LIVE ${users.get(s.user.toLowerCase()).broker} account: this strategy trades real money. Start it? Pass --live to confirm without being asked.`)
      const market = marketOrFail(input.symbol, input.interval)
      o.text(`Starting drcs on ${market.symbol} ${market.interval.code}…`)
      const key = keyOf(market.symbol, market.interval.code)
      // Sessions by name (TradingSupervisor): the same name replaces; none gives drcs, drcs 2, …
      const given = input.opt.name?.trim()
      if (given !== undefined && !/^[\p{L}\p{N} ._-]{1,40}$/u.test(given))
        throw new Exit(1, `'${input.opt.name}' is not a session name: use 1 to 40 letters, digits, spaces, '.', '_' or '-'.`)
      const taken = (n) => [...s.sessions.keys()].some((k) => k.toLowerCase() === n.toLowerCase())
      let name = given
      if (!name) for (let n = 1; !name; n++) if (!taken(n === 1 ? 'drcs' : `drcs ${n}`)) name = n === 1 ? 'drcs' : `drcs ${n}`
      const replacing = [...s.sessions.keys()].find((k) => k.toLowerCase() === name.toLowerCase())
      if (replacing) s.sessions.delete(replacing)
      const session = { name, key, params: input.params, rules: input.rules, startedAt: now(), ticks: 0, trades: 0, lastTick: null, lastError: null, lastErrorAt: null, evaluated: -1, positions: [], nextTickAt: nextBoundary(market.interval.ms) }
      const preview = tick(session, true)
      s.sessions.set(name, session)
      insightPanel(o, market, preview)
      o.text(`✓ ${replacing ? 'Replaced' : 'Started'} ${name}: trading ${market.symbol} ${market.interval.code} with drcs on cTrader DEMO (${describeParams(input.params, input.rules)}).`)
      o.text(`  The newest candle was only previewed; the first trade can come at the next close, ${F.hhmm(session.nextTickAt)} UTC. Each tick prints a line here.`)
    },
    'trading stop': (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--name': { alias: '-n', value: true } })
      requireLogin()
      const symbol = pos[0]?.toUpperCase()
      const interval = pos[1] ? parseInterval(pos[1]) : null
      const matching = [...s.sessions.values()].filter((x) => (!opt.name || x.name.toLowerCase() === opt.name.trim().toLowerCase())
        && (!symbol || x.key.startsWith(`${symbol} `)) && (!interval || x.key.endsWith(` ${interval.code}`)))
      if (!matching.length) {
        o.text('No matching strategy is trading.')
        return 1
      }
      for (const x of matching) {
        o.text(`Stopping ${x.name} on ${x.key} after its tick in progress…`)
        s.sessions.delete(x.name)
        o.text(`✓ Stopped ${x.name} on ${x.key} (drcs) after ${x.ticks} ticks and ${x.trades} trades.`)
      }
    },
    'trading status': (o) => {
      requireLogin()
      strategiesSection(o, [...s.sessions.values()], now())
    },
    'orders list': (o, argv) => {
      const { opt } = readArgs(argv, { '--broker': {}, '--symbol': { alias: '-s', value: true } })
      if (opt.broker) requireLogin()
      const list = (opt.broker ? s.positions : s.records).filter((r) => !opt.symbol || r.symbol === opt.symbol.toUpperCase())
      if (!list.length) return o.text(opt.broker ? 'The broker has no open positions or pending orders.' : 'No orders recorded.')
      o.table(['Id', 'Symbol', 'Side', 'Quantity', 'Price', 'Status', 'Type', 'Created (UTC)'], list.map((r) => [r.orderId, r.symbol, r.side, F.number(r.quantity), F.price(r.price), r.status === 'Filled' ? 'open' : r.status === 'None' ? 'closed' : r.status, r.type, F.time(r.createdAt)]))
    },
    'orders place': (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--yes': { alias: '-y' } })
      requireLogin()
      const [symbolText, sideText, quantityText] = pos
      if (!symbolText) throw new Exit(1, 'Symbol is required; pass it with the SYMBOL argument.')
      if (!sideText) throw new Exit(1, 'Cannot show selection prompt since the current terminal isn\'t interactive.')
      if (!quantityText) throw new Exit(1, "The command asked a question, which nobody can answer over the API. Pass the value as an argument or option instead (-y confirms, -d takes the strategy defaults; '<command> --help' lists them).")
      const side = { buy: 'Buy', sell: 'Sell' }[sideText.toLowerCase()]
      const quantity = Number(quantityText)
      if (!side) throw new Exit(1, `Requested value '${sideText}' was not found.`)
      const symbol = symbolText.toUpperCase()
      if (!opt.yes) throw new Exit(1, `Place a market ${side.toLowerCase()} of ${F.number(quantity)} ${symbol} on cTrader DEMO? Pass --yes to confirm without being asked.`)
      if (!SYMBOLS[symbol]) throw new Exit(1, `Unknown cTrader symbol: ${symbol}`, BROKER_HINT)
      if (!(quantity > 0)) throw new Exit(1, 'cTrader order error INVALID_REQUEST: Order volume must be positive.', BROKER_HINT)
      o.text('Placing…')
      const order = open(symbol, side, quantity, null)
      o.text(`✓ Filled: ${side} ${F.number(quantity)} ${symbol} @ ${F.price(order.price)} (id ${order.orderId}).`)
    },
    'orders close': (o, argv) => {
      const { pos, opt } = readArgs(argv, { '--yes': { alias: '-y' } })
      if (!pos[0]) throw new Exit(2, "Command 'close' is missing required argument 'ID'.", HELP_HINT)
      requireLogin()
      const position = s.positions.find((p) => p.orderId === pos[0])
      if (!position) throw new Exit(1, `The broker has no open position or order ${pos[0]}. 'orders list --broker' shows them.`)
      if (!opt.yes) throw new Exit(1, `Close position ${position.orderId}: ${position.side} ${F.number(position.quantity)} ${position.symbol} @ ${F.price(position.price)}? Pass --yes to confirm without being asked.`)
      o.text('Closing…')
      closePosition(position, null)
      for (const x of s.sessions.values()) x.positions = x.positions.filter((id) => id !== position.orderId)
      o.text(`✓ Close position ${position.orderId}: done.`)
    },
    'orders clear': (o, argv) => {
      const { opt } = readArgs(argv, { '--yes': { alias: '-y' } })
      if (!s.records.length) return
      if (!opt.yes) throw new Exit(1, `Delete the bot's ${s.records.length} order records? (Nothing changes at the broker.) Pass --yes to confirm without being asked.`)
      const n = s.records.length
      s.records = []
      o.text(`✓ Deleted ${n} order records.`)
    },
  }
  const candleJson = (c) => ({ openTime: new Date(c.openTime).toISOString(), closeTime: new Date(c.closeTime).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })
  const snapshotLog = () => `/opt/beyondbot/logs/beyondbot-${new Date(startedAt).toISOString().slice(0, 10).replace(/-/g, '')}.log`

  function backtestRun(market, p, rules, initial, startAt, endAt) {
    const cache = indicators(market.candles, p.depth)
    let balance = initial
    let peak = initial
    const open = []
    const r = { evaluated: 0, closed: 0, won: 0, lost: 0, maxProfit: 0, maxProfitPercent: 0, maxDrawdown: 0, maxDrawdownPercent: 0 }
    market.candles.forEach((c, i) => {
      if (c.openTime < startAt || c.closeTime > endAt) return
      if (WEEKEND.has(market.symbol) && isWeekend(c.closeTime)) return
      r.evaluated++
      const { signal } = explain(market.candles, i, p, rules, cache)
      // Backtesting/BacktestLedger.cs: a close closes the newest open position on its side.
      const newest = signal.action === 'Close' ? open.findLastIndex((position) => position.side === signal.side) : -1
      if (signal.action === 'Open') open.push({ quantity: (balance * signal.balanceShare) / c.close, price: c.close, side: signal.side })
      else if (newest >= 0) {
        const [position] = open.splice(newest, 1)
        const pnl = (c.close - position.price) * position.quantity * (position.side === 'Buy' ? 1 : -1)
        const before = balance
        balance += pnl
        r.closed++
        if (pnl > 0) r.won++
        if (pnl < 0) r.lost++
        r.maxProfit = Math.max(r.maxProfit, pnl)
        r.maxProfitPercent = Math.max(r.maxProfitPercent, before > 0 ? (pnl / before) * 100 : 0)
        peak = Math.max(peak, balance)
        r.maxDrawdown = Math.min(r.maxDrawdown, balance - peak)
        r.maxDrawdownPercent = Math.min(r.maxDrawdownPercent, peak > 0 ? ((balance - peak) / peak) * 100 : 0)
      }
    })
    return { ...r, balance, open: open.length }
  }

  // ---------- the starting state: a signed-in Demo account trading XAUUSD 1h ----------
  const xau = createMarket('XAUUSD', parseInterval('1h'), options.history ?? 1600)
  createMarket('EURUSD', parseInterval('4h'), 900)
  if (options.signedIn !== false) {
    signIn(new Out(), 'demo')
    // The server's own startup account: a connection reaches it only by signing in to it.
    s.startupUser = 'demo'
    s.stats.startBalance = 9875.4
    s.account.balance = 10012.85
    s.stats.realizedProfit = 137.45
    s.stats.wins = 3
    s.stats.losses = 1
    s.stats.tradesOpened = 5
    s.stats.tradesClosed = 4
    const position = open('XAUUSD', 'Buy', 2, 'drcs')
    position.price = round(xau.candles.at(-6).close, 2)
    s.records.at(-1).price = position.price
    s.records.unshift({ orderId: '812301', symbol: 'XAUUSD', quantity: 2, price: round(xau.candles.at(-90).close, 2), status: 'None', type: 'Market', side: 'Buy', createdAt: xau.candles.at(-90).closeTime })
    if (options.trading !== false) {
      const startParams = params()
      const session = { name: 'drcs', key: 'XAUUSD 1h', params: startParams, rules: rulesOf([], startParams), startedAt: now() - 5 * 3600e3 - 12 * 60e3, ticks: 5, trades: 1, lastTick: null, lastError: null, lastErrorAt: null, evaluated: -1, positions: [position.orderId], nextTickAt: nextBoundary(3600e3) }
      tick(session, true)
      session.lastTick = { ...session.lastTick, outcome: 'Evaluated' }
      s.sessions.set('drcs', session)
    }
    s.loaded.add('XAUUSD 1h')
  }

  const HELP = `USAGE:
    beyondbot [OPTIONS] <COMMAND>

COMMANDS:
    login          Log in: connects to the broker and reads your account.
    register       Create a user and store their broker credentials, encrypted.
    logout         Stop trading, disconnect and log out.
    credentials    Change your password or broker credentials.
    status         Health check: database, login, broker connection.
    session        Your session: account, positions, statistics, strategies and system.
    balance        Balance, equity, unrealized P/L and change since login (session account).
    positions      Open positions with live prices and P/L (session positions).
    market         add, sync, list, remove
    candles        show, oldest
    indicators     show
    strategies     The strategies the bot can run, with their parameters and rules.
    signal         What a strategy decides on the newest candle, and why. Never trades.
    backtest       Replay a strategy over stored candles with a simulated account.
    trading        start, stop, status
    orders         list, place, close, clear`

  /** Runs one command; resolves to the same CommandResult the real API sends. */
  // The running command's connection (server.mjs): { accounts, current }; none for a direct caller (the old single-login bot).
  const ctx = { connection: undefined, picked: null }

  /**
   * Runs one command; resolves to the same CommandResult the real API sends. `connection` is the caller's bot
   * connection ({ accounts, current }, changed by login, logout and use); `account` one of its accounts picked for
   * this command only. Without `connection` the bot behaves as before accounts: one login for every caller.
   */
  async function run(argv, { signal, connection, account } = {}) {
    ctx.connection = connection
    ctx.picked = account ?? null
    const acting = () => {
      const login = connection ? (ctx.picked ?? connection.current) : s.startupUser
      return login && s.open.has(login.toLowerCase()) ? s.open.get(login.toLowerCase()).login : null
    }
    s.user = acting()
    const o = new Out()
    let code = 0
    let error = null
    let json = null
    try {
      const help = argv.includes('--help') || argv.includes('-h')
      const [first, second] = argv
      const twoWord = `${first} ${second}`
      const branch = ['market', 'candles', 'indicators', 'trading', 'orders'].includes(first)
      if (help || !first) {
        o.text(first && !first.startsWith('-') ? `USAGE:\n    beyondbot ${argv.filter((a) => a !== '--help' && a !== '-h').join(' ')} [OPTIONS]` : HELP)
      } else if (branch && commands[twoWord]) {
        const answer = await commands[twoWord](o, argv.slice(2), undefined, signal)
        if (typeof answer === 'number') code = answer
      } else if (branch) {
        throw new Exit(2, second ? `Unknown command '${second}'.` : `Command '${first}' needs a sub-command.`, HELP_HINT)
      } else if (commands[first]) {
        const answer = await commands[first](o, argv.slice(1), undefined, signal)
        if (typeof answer === 'number') code = answer
        if (answer && typeof answer === 'object') json = answer.json
      } else {
        throw new Exit(2, `Unknown command '${first}'.`, HELP_HINT)
      }
    } catch (failure) {
      if (failure instanceof Exit) {
        code = failure.code
        error = { message: failure.message, hint: failure.hint }
      } else {
        code = 1
        error = { message: `Unexpected error: ${failure.message}`, hint: 'The log file has the details; --verbose prints them here.' }
      }
    }
    const blocks = merge(o.blocks)
    const text = render(blocks) + (error ? `✗ ${error.message}\n${error.hint ? `  ${error.hint}\n` : ''}` : '')
    // Like Api/CommandRunner.cs: with --json, `json` is the output parsed (null when it is not JSON).
    if (argv.includes('--json')) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { exitCode: code, output: text, blocks, error, json, account: connection ? acting() : undefined }
  }

  return {
    run,
    state: s,
    now,
    advance(ms) {
      offset += ms
      runTicks()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
}
