import type { StrategyDefinition } from '../parse/strategies.ts'

/** Catalog entries for tests: the bot's own strategy, one the app has never heard of, and one from before rules. */

export const DRCS: StrategyDefinition = {
  name: 'drcs',
  title: 'Double Red Cross',
  description: 'Bands around the EMA.',
  defaultMarket: { symbol: 'XAUUSD', interval: '1h' },
  parameters: [
    { name: 'depth', default: 23, min: 1, max: 500, meaning: 'Lookback', whole: true },
    { name: 'deviation', default: 1, min: 1, max: 20, meaning: 'Spacing', whole: true },
    { name: 'moving-count', default: 2, min: 1, max: 10, meaning: 'Bands', whole: true },
  ],
  rules: { defaults: ['open long on cross up lower 1', 'close long on cross down lower 1'], syntax: 'open|close long|short on cross up|down lower|upper N' },
}

/** A strategy the app has never heard of, with a decimal parameter and another kind of condition. */
export const MOMENTUM: StrategyDefinition = {
  name: 'momentum',
  title: 'Momentum',
  description: 'Rides a price above its average.',
  defaultMarket: null,
  parameters: [{ name: 'threshold', default: 0.5, min: 0.1, max: 5, meaning: 'Percent above the average', whole: false }],
  rules: { defaults: ['open long on above ema 20 for 3 candles'], syntax: 'open|close long|short on above|below ema N for N candles' },
}

/** A strategy of a bot from before rules. */
export const LEGACY: StrategyDefinition = { ...DRCS, name: 'old', rules: null, parameters: [...DRCS.parameters, { name: 'trigger', default: 1, min: 1, max: 10, meaning: 'Band', whole: true }] }

