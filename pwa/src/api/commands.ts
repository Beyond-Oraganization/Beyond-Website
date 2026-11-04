/**
 * Every command the app sends, built in one place. Options take the `--option=value` form wherever a value
 * might start with "-" (passwords), and every command passes what a terminal would have asked for
 * (`-y` after the app's own confirmation, the strategy values with `-d`), because nobody can answer a question
 * over the API.
 */

export type SessionSection = 'account' | 'positions' | 'stats' | 'strategies' | 'system'

export type StrategyInput = {
  strategy: string
  symbol: string
  /** Interval code, e.g. "1h". */
  interval: string
  params: Record<string, number>
  /** The rules, in the order they are tried; none means the strategy's defaults. */
  rules?: string[]
}

/** Invariant decimal without grouping or exponent: what `decimal.TryParse(…, InvariantCulture)` reads. */
export const plainNumber = (value: number) =>
  value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 })

/**
 * A UTC date/time without "Z": the bot's option parser may turn a "Z" time into local time before it marks
 * the value as UTC, so the bare form is the safe one.
 */
export function utcArg(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 19)
}

const strategyArgs = ({ strategy, symbol, interval, params, rules = [] }: StrategyInput) => [
  strategy,
  '--symbol',
  symbol,
  '--interval',
  interval,
  ...Object.entries(params).flatMap(([name, value]) => ['--set', `${name}=${plainNumber(value)}`]),
  ...rules.flatMap((rule) => ['--rule', rule]),
  '-d',
]

const credentialArgs = (credentials: [string, string][]) => credentials.flatMap(([key, value]) => ['--credential', `${key}=${value}`])

export const cmd = {
  help: (path: string[] = []) => (path.length ? [...path, '--help'] : ['--help']),
  status: () => ['status'],
  session: (section?: SessionSection) => (section ? ['session', section, '--json'] : ['session', '--json']),

  login: (login: string, password: string) => ['login', login, `--password=${password}`],
  logout: () => ['logout', '-y'],
  register: (login: string, password: string, credentials: [string, string][], force = false) => [
    'register',
    login,
    `--password=${password}`,
    ...credentialArgs(credentials),
    ...(force ? ['--force'] : []),
  ],
  credentials: (current: string, next: string | null, credentials: [string, string][]) => [
    'credentials',
    `--password=${current}`,
    ...(next ? [`--new-password=${next}`] : []),
    ...credentialArgs(credentials),
  ],

  marketList: () => ['market', 'list'],
  marketAdd: (symbol: string, interval: string) => ['market', 'add', symbol, interval],
  marketSync: (symbol?: string, interval?: string) => (symbol && interval ? ['market', 'sync', symbol, interval] : ['market', 'sync']),
  marketRemove: (symbol: string, interval?: string | null) => ['market', 'remove', symbol, ...(interval ? [interval] : []), '--yes'],

  candlesShow: (symbol: string, interval: string, { last, from, to }: { last?: number; from?: Date | number | null; to?: Date | number | null } = {}) => [
    'candles',
    'show',
    symbol,
    interval,
    ...(last ? ['--last', String(last)] : []),
    ...(from != null ? ['--from', utcArg(from)] : []),
    ...(to != null ? ['--to', utcArg(to)] : []),
  ],
  candlesOldest: (symbol: string, interval: string) => ['candles', 'oldest', symbol, interval],
  indicatorsShow: (symbol: string, interval: string, { depth, last }: { depth?: number; last?: number } = {}) => [
    'indicators',
    'show',
    symbol,
    interval,
    ...(depth ? ['--depth', String(depth)] : []),
    ...(last ? ['--last', String(last)] : []),
  ],

  strategies: () => ['strategies', '--json'],
  /** The catalog of a bot from before rules, which has no --json. */
  strategiesText: () => ['strategies'],
  signal: (input: StrategyInput) => ['signal', ...strategyArgs(input)],
  backtest: (input: StrategyInput, { balance, from, to }: { balance?: number; from?: Date | number | null; to?: Date | number | null } = {}) => [
    'backtest',
    ...strategyArgs(input),
    ...(balance != null ? ['--balance', plainNumber(balance)] : []),
    ...(from != null ? ['--from', utcArg(from)] : []),
    ...(to != null ? ['--to', utcArg(to)] : []),
  ],

  tradingStart: (input: StrategyInput) => ['trading', 'start', ...strategyArgs(input)],
  tradingStop: (symbol?: string, interval?: string) => ['trading', 'stop', ...(symbol ? [symbol] : []), ...(symbol && interval ? [interval] : [])],
  tradingStatus: () => ['trading', 'status'],

  ordersList: ({ broker = false, symbol }: { broker?: boolean; symbol?: string | null } = {}) => [
    'orders',
    'list',
    ...(broker ? ['--broker'] : []),
    ...(symbol ? ['--symbol', symbol] : []),
  ],
  ordersPlace: (symbol: string, side: 'buy' | 'sell', quantity: number) => ['orders', 'place', symbol, side, plainNumber(quantity), '--yes'],
  ordersClose: (id: string) => ['orders', 'close', id, '--yes'],
  ordersClear: () => ['orders', 'clear', '--yes'],
}

/** Commands that change the bot or the broker: the Console asks before sending them. */
export function isDestructive(args: string[]): boolean {
  const [first, second] = args.map((arg) => arg.toLowerCase())
  if (first === 'orders' && (second === 'place' || second === 'close' || second === 'clear')) return true
  if (first === 'market' && second === 'remove') return true
  if (first === 'trading' && (second === 'stop' || second === 'start')) return true
  if (first === 'logout' || first === 'login') return true
  if (first === 'credentials') return true
  if (first === 'register' && args.some((arg) => arg === '-f' || arg === '--force')) return true
  return false
}
