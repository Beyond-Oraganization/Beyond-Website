import type { CommandResult } from '../types.ts'

/**
 * Answers transcribed from the bot's own tests: Tests/BeyondBot.Tests/Cli/Approved/*.txt (the console output the
 * bot pins) and Tests/BeyondBot.Tests/Api/*Tests.cs, as Api/OutputRecorder.cs turns them into blocks.
 */
const base = { ok: true, exitCode: 0, elapsedMs: 41, error: null, json: null, output: '' }

export const realBacktest: CommandResult = {
  ...base,
  command: 'backtest drcs -d --symbol BTCUSDT --to 2025-03-30T08:00:00',
  blocks: [
    { type: 'text', text: 'Reading BTCUSDT 1h candles…' },
    {
      type: 'section',
      title: 'Backtest: drcs on BTCUSDT 1h',
      blocks: [
        {
          type: 'grid',
          rows: [
            ['Period', '2025-01-06 00:00 → 2025-03-30 08:00 UTC, 2,000 candles'],
            ['Balance', '1,000.00 → 1,015.03'],
            ['Profit / loss', '+15.03 +1.50%'],
            ['Trades', '80 closed: 23 won, 57 lost, win rate 28.8%'],
            ['Average per trade', '+0.19'],
            ['Best trade', '+19.40 (1.93%)'],
            ['Max drawdown', '-29.14 (-2.80%)'],
            ['Computed in', '87 ms'],
          ],
        },
      ],
    },
    { type: 'text', text: 'depth=23 deviation=1 moving-count=2, rules: open long on cross up lower 1; close long on cross down lower 1' },
  ],
}

/**
 * `backtest` of a bot with position sizing (Beyond-Bot-Bybit position-sizing, Backtest_PrintsTheReport.txt): the
 * Sizing and Kelly rows, and the line naming the stored backtest.
 */
export const realSizedBacktest: CommandResult = {
  ...realBacktest,
  blocks: [
    { type: 'text', text: 'Reading BTCUSDT 1h candles…' },
    {
      type: 'section',
      title: 'Backtest: drcs on BTCUSDT 1h',
      blocks: [
        {
          type: 'grid',
          rows: [
            ['Period', '2025-01-06 00:00 → 2025-03-30 08:00 UTC, 2,000 candles'],
            ['Balance', '1,000.00 → 1,015.03'],
            ['Profit / loss', '+15.03 +1.50%'],
            ['Trades', '80 closed: 23 won, 57 lost, win rate 28.8%'],
            ['Sizing', '50% of the balance per position'],
            ['Kelly', '3.26% of the balance: win rate 28.8%, loss rate 71.3%, payoff 2.80 (average win +1.22%, average loss -0.43%)'],
            ['Average per trade', '+0.19'],
            ['Best trade', '+19.40 (1.93%)'],
            ['Max drawdown', '-29.14 (-2.80%)'],
            ['Computed in', '87 ms'],
          ],
        },
      ],
    },
    {
      type: 'text',
      text: "depth=23 deviation=1 moving-count=2, rules: open long on cross up lower 1; close long on cross down lower 1\nStored as backtest #1; 'backtests' lists them. Kelly sizing of this setup reads the newest one that starts at the first stored candle.",
    },
  ],
}

/** `strategies` of a bot from before rules (no --json): the panels the app falls back to. */
export const legacyStrategies: CommandResult = {
  ...base,
  command: 'strategies',
  blocks: [
    {
      type: 'section',
      title: 'drcs – Double Red Cross',
      blocks: [
        {
          type: 'text',
          text: 'Builds an adaptive envelope of bands spaced by ATR × deviation below and above the EMA. Buys half of the balance when a candle opens below the trigger band and closes above it, and closes the newest position when a candle crosses back down through it.\nDefault market: XAUUSD 1h',
        },
        {
          type: 'table',
          title: null,
          columns: ['Parameter', 'Default', 'Range', 'Meaning'],
          rows: [
            ['depth', '23', '1–500', 'Lookback of the EMA and ATR the envelope is built from'],
            ['deviation', '1', '1–20', 'ATR multiplier between neighbouring bands'],
            ['moving-count', '2', '1–10', 'Number of bands on each side of the center'],
            ['trigger', '1', '1–10', 'Which lower band (1 = nearest the center) triggers signals'],
          ],
        },
      ],
    },
    { type: 'text', text: 'Set a parameter with --set NAME=VALUE, e.g. backtest drcs --set depth=30.' },
  ],
}

export const realMissingMarket: CommandResult = {
  ...base,
  ok: false,
  exitCode: 1,
  command: 'backtest drcs -d --symbol NOPE',
  blocks: [],
  error: { message: 'NOPE 1h is not set up.', hint: 'Add it with: market add NOPE 1h' },
  output: '✗ NOPE 1h is not set up.\n  Add it with: market add NOPE 1h\n',
}

export const realMarketList: CommandResult = {
  ...base,
  command: 'market list',
  blocks: [
    {
      type: 'table',
      title: null,
      columns: ['Symbol', 'Interval', 'Candles', 'First', 'Newest', 'Age', 'Trading'],
      rows: [
        ['BTCUSDT', '1h', '5', '2025-01-06 00:00', '2025-01-06 04:00', '3d 4h', ''],
        ['XAUUSD', '1h', '45,123', '2019-01-02 00:00', '2026-11-04 08:00', '1h 05m', 'yes'],
        ['EURPLN', 'none', '0', '–', '–', '–', ''],
      ],
    },
  ],
}

export const realSignedOut: CommandResult = {
  ...base,
  ok: false,
  exitCode: 3,
  command: 'session --json',
  blocks: [],
  error: { message: 'You need to log in first.', hint: "Run 'login' (or 'register' to create an account)." },
}

/** `strategies --json` of a bot before position sizing (Beyond-Bot-Bybit 9af5cd0, Cli/Rendering/StrategyCatalogJson.cs); `json` is that output parsed. */
export const realStrategiesJson: CommandResult = {
  ...base,
  command: 'strategies --json',
  blocks: [],
  json: [
    {
      name: 'drcs',
      title: 'Double Red Cross',
      description:
        'Builds an adaptive envelope of bands spaced by ATR × deviation below and above the EMA: lower 1 and upper 1 are nearest the center, up to moving-count on each side. Its rules trade on candles crossing those bands, and each open spends half of the balance. By default it buys when a candle opens below lower 1 and closes above it, and closes the newest long when a candle crosses back down through it.',
      symbol: 'XAUUSD',
      interval: '1h',
      parameters: [
        { name: 'depth', description: 'Lookback of the EMA and ATR the envelope is built from', default: 23, minimum: 1, maximum: 500, wholeNumber: true },
        { name: 'deviation', description: 'ATR multiplier between neighbouring bands', default: 1, minimum: 1, maximum: 20, wholeNumber: true },
        { name: 'moving-count', description: 'Number of bands on each side of the center', default: 2, minimum: 1, maximum: 10, wholeNumber: true },
      ],
      rules: { defaults: ['open long on cross up lower 1', 'close long on cross down lower 1'], syntax: 'open|close long|short on cross up|down lower|upper N' },
    },
  ],
}

/** The `sizing` every strategy of `strategies --json` carries since position sizing (Beyond-Bot-Bybit position-sizing). */
export const realSizingJson = {
  default: 'percent:50',
  syntax: 'percent:N | fixed:AMOUNT | kelly[:N]',
  methods: [
    {
      name: 'percent',
      title: 'Percentage of the balance',
      description: 'Each position is worth this percent of the balance when it opens.',
      value: { name: 'percent', description: 'Percent of the balance each position is worth', default: 50, minimum: 0.01, maximum: 100, wholeNumber: false },
    },
    {
      name: 'fixed',
      title: 'Fixed amount',
      description: "Each position is worth this amount of the account's currency when it opens, whatever the balance.",
      value: { name: 'amount', description: "Amount each position is worth, in the account's currency", default: 100, minimum: 0.01, maximum: 1000000000, wholeNumber: false },
    },
    {
      name: 'kelly',
      title: 'Kelly criterion',
      description:
        'Each position is worth the Kelly percent of the balance, (b·p − q) / b, from the newest full-history backtest of the same setup (run once when there is none): p is the share of trades won, q the share lost, b the average win over the average loss. The value is how much of Kelly to use: 100 is full Kelly, 50 half. It refuses to start without an edge or with fewer than 20 closed trades.',
      value: { name: 'share', description: 'Percent of the Kelly percent to use', default: 100, minimum: 1, maximum: 100, wholeNumber: false },
    },
  ],
}

/** `strategies --json` with position sizing. */
export const realSizedStrategiesJson: CommandResult = {
  ...realStrategiesJson,
  json: (realStrategiesJson.json as object[]).map((strategy) => ({ ...strategy, sizing: realSizingJson })),
}
