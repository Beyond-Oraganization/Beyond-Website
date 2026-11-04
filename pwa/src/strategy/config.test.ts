import { describe, expect, it } from 'vitest'
import { cmd } from '../api/commands.ts'
import type { MarketRow } from '../api/parse/markets.ts'
import { DRCS, LEGACY, MOMENTUM } from '../api/fixtures/catalog.ts'
import { applySetup, initialConfig, paramKey, ruleKey, toInput, usesDefaultRules, validateConfig, withStrategy, type StrategyConfig } from './config.ts'

const markets: MarketRow[] = [
  { symbol: 'EURUSD', interval: '4h', candles: 1, first: null, newest: null, age: null, trading: false },
  { symbol: 'XAUUSD', interval: '1h', candles: 1, first: null, newest: null, age: null, trading: true },
  { symbol: 'EURPLN', interval: null, candles: 0, first: null, newest: null, age: null, trading: false },
]
const drcsConfig = (change: Partial<StrategyConfig> = {}): StrategyConfig => ({ ...initialConfig([DRCS], markets)!, ...change })

describe('initialConfig', () => {
  it('starts from the strategy’s defaults, its rules included, on its own market when it is stored', () => {
    expect(initialConfig([DRCS], markets)).toEqual({ strategy: 'drcs', market: 'XAUUSD 1h', params: { depth: '23', deviation: '1', 'moving-count': '2' }, rules: DRCS.rules!.defaults })
  })

  it('prefers the market and strategy asked for, and falls back to the first stored market', () => {
    expect(initialConfig([DRCS, MOMENTUM], markets, { symbol: 'EURUSD', interval: '4h', strategy: 'momentum' })).toMatchObject({ strategy: 'momentum', market: 'EURUSD 4h', params: { threshold: '0.5' } })
    expect(initialConfig([MOMENTUM], markets)?.market).toBe('EURUSD 4h')
    expect(initialConfig([DRCS], [])?.market).toBe('')
    expect(initialConfig([], markets)).toBeNull()
  })
})

describe('validateConfig', () => {
  it('accepts the defaults of any strategy', () => {
    for (const definition of [DRCS, MOMENTUM, LEGACY]) expect(validateConfig(withStrategy(drcsConfig(), definition), definition), definition.name).toEqual({})
  })

  it('checks every parameter against its range, whole or not, from the catalog alone', () => {
    expect(validateConfig(drcsConfig({ params: { depth: '0', deviation: '1.5', 'moving-count': '' } }), DRCS)).toEqual({
      [paramKey('depth')]: 'depth must be between 1 and 500.',
      [paramKey('deviation')]: 'deviation must be a whole number.',
      [paramKey('moving-count')]: 'moving-count must be a number.',
    })
    expect(validateConfig({ ...withStrategy(drcsConfig(), MOMENTUM), params: { threshold: '1.25' } }, MOMENTUM)).toEqual({})
  })

  it('checks each rule against the strategy’s own syntax', () => {
    const errors = validateConfig(drcsConfig({ rules: ['open short on cross down upper 2', 'open long on band lower 1', '', 'open long on cross up lower 1; close long on cross down lower 1'] }), DRCS)
    expect(errors).toEqual({
      [ruleKey(1)]: 'Write it as: open|close long|short on cross up|down lower|upper N.',
      [ruleKey(2)]: 'Write the rule, or remove it.',
      [ruleKey(3)]: 'One rule per line: put the next rule on its own line.',
    })
    expect(validateConfig({ ...withStrategy(drcsConfig(), MOMENTUM), rules: ['close short on below ema 20 for 3 candles'] }, MOMENTUM)).toEqual({})
  })

  it('needs at least one rule from a strategy with rules, and none from one without', () => {
    expect(validateConfig(drcsConfig({ rules: [] }), DRCS).rules).toBe('Add at least one rule, or reset them to the defaults.')
    expect(validateConfig({ ...withStrategy(drcsConfig(), LEGACY), rules: [] }, LEGACY)).toEqual({})
  })

  it('leaves to the bot what depends on several values, such as a band beyond moving-count', () => {
    expect(validateConfig(drcsConfig({ rules: ['open long on cross up lower 9'] }), DRCS)).toEqual({})
  })

  it('needs a strategy and a stored market', () => {
    expect(validateConfig(drcsConfig(), undefined)).toEqual({ strategy: 'Choose a strategy.' })
    expect(validateConfig(drcsConfig({ market: '' }), DRCS).market).toBe('Choose a stored market.')
  })
})

describe('toInput and the command it makes', () => {
  it('sends every parameter and every rule, in order', () => {
    const input = toInput(drcsConfig({ params: { depth: '30', deviation: '1', 'moving-count': '3' }, rules: ['open  short on cross down upper 3 ', 'close short on cross up upper 3'] }), DRCS)
    expect(cmd.backtest(input)).toEqual([
      'backtest', 'drcs', '--symbol', 'XAUUSD', '--interval', '1h',
      '--set', 'depth=30', '--set', 'deviation=1', '--set', 'moving-count=3',
      '--rule', 'open short on cross down upper 3', '--rule', 'close short on cross up upper 3', '-d',
    ])
  })

  it('sends no rules to a bot from before rules, which would refuse the option', () => {
    expect(cmd.signal(toInput({ ...withStrategy(drcsConfig(), LEGACY) }, LEGACY))).not.toContain('--rule')
  })
})

describe('withStrategy, applySetup and usesDefaultRules', () => {
  it('switching strategy takes its defaults and keeps the market', () => {
    expect(withStrategy(drcsConfig({ market: 'EURUSD 4h' }), MOMENTUM)).toEqual({ strategy: 'momentum', market: 'EURUSD 4h', params: { threshold: '0.5' }, rules: MOMENTUM.rules!.defaults })
  })

  it('a saved setup meets today’s catalog: gone parameters are dropped and named, new ones take defaults', () => {
    const { config, dropped } = applySetup(drcsConfig({ market: 'EURUSD 4h' }), { strategy: 'drcs', params: { depth: '40', trigger: '2' }, rules: ['open short on cross down upper 1'] }, DRCS)
    expect(dropped).toEqual(['trigger'])
    expect(config).toEqual({ strategy: 'drcs', market: 'EURUSD 4h', params: { depth: '40', deviation: '1', 'moving-count': '2' }, rules: ['open short on cross down upper 1'] })
    expect(applySetup(drcsConfig(), { strategy: 'drcs', params: {}, rules: [] }, DRCS).config.rules).toEqual(DRCS.rules!.defaults)
    expect(applySetup(drcsConfig(), { strategy: 'old', params: {}, rules: ['open long on cross up lower 1'] }, LEGACY).config.rules).toEqual([])
  })

  it('knows when the rules are the defaults', () => {
    expect(usesDefaultRules(drcsConfig(), DRCS)).toBe(true)
    expect(usesDefaultRules(drcsConfig({ rules: [...DRCS.rules!.defaults].reverse() }), DRCS)).toBe(false)
  })
})
