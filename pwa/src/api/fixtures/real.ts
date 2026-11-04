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
    { type: 'text', text: 'depth=23 deviation=1 moving-count=2 trigger=1' },
  ],
}

export const realStrategies: CommandResult = {
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
