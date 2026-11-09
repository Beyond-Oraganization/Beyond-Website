/**
 * The bot's HTTP command API, as Api/CommandResult.cs serializes it (camelCase, nulls written), and the
 * session snapshot that `session --json` prints (Session/SessionSnapshot.cs, Trading/TradingEvents.cs,
 * Strategies/*.cs; enums as names, TimeSpan in .NET's "c" format, decimals as numbers).
 */

export type TextBlock = { type: 'text'; text: string }
export type TableBlock = { type: 'table'; title: string | null; columns: string[]; rows: string[][] }
export type GridBlock = { type: 'grid'; rows: string[][] }
export type SectionBlock = { type: 'section'; title: string; blocks: OutputBlock[] }
export type OutputBlock = TextBlock | TableBlock | GridBlock | SectionBlock

export type CommandError = { message: string; hint: string | null }

export type CommandResult = {
  /** The command as run, with passwords and credential values shown as ***. */
  command: string
  exitCode: number
  ok: boolean
  /** How long the command ran, without its wait in the bot's queue. */
  elapsedMs: number
  output: string
  blocks: OutputBlock[]
  error: CommandError | null
  json: unknown
  /** The trading account the command acted on; null when the connection holds none (or the bot predates accounts). */
  account?: string | null
  /** Only in the answer to the login that created this device's connection: its token. */
  connection?: string | null
}

/** Cli/ErrorReporter.cs */
export const ExitCode = { Success: 0, Failure: 1, Usage: 2, NotSignedIn: 3, Cancelled: 130 } as const

/** ISO 8601, UTC ("…Z"). */
export type Iso = string
/** .NET TimeSpan "c" format: [-][d.]hh:mm:ss[.fffffff] */
export type Span = string

export type IntervalName =
  | 'OneMinute'
  | 'ThreeMinutes'
  | 'FiveMinutes'
  | 'FifteenMinutes'
  | 'ThirtyMinutes'
  | 'OneHour'
  | 'TwoHours'
  | 'FourHours'
  | 'SixHours'
  | 'EightHours'
  | 'TwelveHours'
  | 'OneDay'
  | 'ThreeDays'
  | 'OneWeek'
  | 'OneMonth'

export type MarketIdJson = { symbol: string; interval: IntervalName }
export type OrderSide = 'Buy' | 'Sell' | 'None'
export type OrderStatus = 'New' | 'PartiallyFilled' | 'Filled' | 'Canceled' | 'Rejected' | 'None'
export type OrderType = 'Market' | 'Limit' | 'StopLoss' | 'TakeProfit' | 'None'

export type AccountSnapshot = {
  broker: string
  mode: 'Demo' | 'Live'
  accountId: string | null
  balance: number | null
  currency: string
  equity: number | null
  equityIsComplete: boolean
  unrealizedProfit: number | null
  changeSinceStart: number | null
  changeSinceStartPercent: number | null
  leverage: number | null
  exposure: number
  updatedAt: Iso | null
  error: string | null
}

export type PositionSnapshot = {
  id: string
  symbol: string
  side: OrderSide
  quantity: number
  entryPrice: number
  currentPrice: number | null
  unrealizedProfit: number | null
  profitCurrency: string
  inAccountCurrency: boolean
  isConverted: boolean
  isPending: boolean
  openedAt: Iso
}

export type SessionStats = {
  user: string | null
  startedAt: Iso
  uptime: Span
  startBalance: number | null
  tradesOpened: number
  tradesClosed: number
  realizedProfit: number
  wins: number
  losses: number
}

/**
 * A close names its side; a bot from before rules closed the newest position of any side ('CloseNewest'). A bot from
 * before position sizing also sent the share of the balance an open spends; since, the session's `sizing` says it.
 */
export type Signal = { action: 'None' | 'Open' | 'Close' | 'CloseNewest'; side: OrderSide; balanceShare?: number }
/** `isLevel`: a price level the candle was compared with, such as a band (bots from before rules send no flag). */
export type InsightValue = { name: string; value: number; isLevel?: boolean }
export type StrategyInsight = { signal: Signal; reason: string; values: InsightValue[] }

export type Candle = {
  openTime: Iso
  closeTime: Iso
  open: number
  high: number
  low: number
  close: number
  volume: number
  isFlat?: boolean
  range?: number
}

export type OrderJson = {
  orderId: string
  symbol: string
  quantity: number
  price: number
  status: OrderStatus
  type: OrderType
  side: OrderSide
  createdAt: Iso
}

export type TradeExecuted = { market: MarketIdJson; strategy: string; action: 'Opened' | 'Closed'; order: OrderJson; time: Iso }

export type TickOutcome = 'Evaluated' | 'Preview' | 'NoNewCandle' | 'MarketClosed' | 'Failed'

export type TickReport = {
  market: MarketIdJson
  strategy: string
  time: Iso
  outcome: TickOutcome
  candle: Candle | null
  insight: StrategyInsight | null
  candlesAdded: number
  trade: TradeExecuted | null
  elapsed: Span
  nextTickAt: Iso
  error: string | null
}

/** The numbers behind a Kelly percent: a backtest's closed trades (Sizing/KellyEstimate.cs). */
export type KellyEstimate = {
  trades: number
  wins: number
  losses: number
  /** The average return of the winning trades per unit of position value (0.012 is +1.2 %). */
  averageWin: number
  /** The average size of the losing trades' returns, positive. */
  averageLoss: number
  winProbability: number
  lossProbability: number
  payoffRatio: number | null
  /** Kelly in percent. */
  percent: number | null
  whyUnusable: string | null
}

/** How a running session sizes its positions (Sizing/PositionSizing.cs). */
export type SessionSizing = {
  method: 'Percent' | 'Fixed' | 'Kelly'
  /** Fixed: the amount per position; Percent and Kelly: the percent of the balance. */
  value: number
  /** Where a Kelly percent came from; null for the other methods. */
  kelly: { estimate: KellyEstimate; shareOfKelly: number; backtestId: number; backtestedAt: Iso; from: Iso; to: Iso } | null
}

export type TradingSessionState = {
  /** The session's name (several can trade one market); a bot from before names sends none: use `sessionName`. */
  name?: string
  market: MarketIdJson
  strategy: string
  parameters: Record<string, number>
  /** The rules it trades by, in order (a bot from before rules sends none). */
  rules?: string[]
  /** How it sizes its positions (a bot from before sizing sends none: half the balance). */
  sizing?: SessionSizing
  startedAt: Iso
  ticks: number
  trades: number
  lastTick: TickReport | null
  lastError: string | null
  lastErrorAt: Iso | null
  nextTickAt: Iso
}

export type BrokerConnection = { isConnected: boolean; connectedSince: Iso | null; lastLatency: Span | null; lastError: string | null }

export type DatabaseHealth = {
  isConnected: boolean
  server: string
  database: string
  schemaVersion: number
  serverVersion: string | null
  latency: Span
  error: string | null
}

export type MarketFreshness = { market: MarketIdJson; candles: number; newestOpenTime: Iso | null; age: Span | null }

export type SystemSnapshot = {
  version: string
  processUptime: Span
  broker: BrokerConnection
  database: DatabaseHealth | null
  databaseCheckedAt: Iso | null
  markets: MarketFreshness[]
  managedMemoryBytes: number
  workingSetBytes: number
  logPath: string | null
}

export type SessionSnapshot = {
  time: Iso
  account: AccountSnapshot
  positions: PositionSnapshot[]
  stats: SessionStats
  strategies: TradingSessionState[]
  system: SystemSnapshot
}
