import { describe, expect, it } from 'vitest'
import { deviceAnswer, scenariosAnswer, summaryAnswer } from './fixtures.ts'
import { figuresOf } from './figures.ts'
import { curveByTime, endedAbove, keep, keepScenarios, kellyShare, type DeviceRun } from './runs.ts'

const run = (answer = deviceAnswer()): DeviceRun => ({
  kind: 'device', id: '1', at: 0, input: { strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', params: {} }, balance: 1000, from: null, to: null, scenarios: 3, method: 'Bootstrap', result: keep(answer),
})

describe('a device backtest as the page keeps it', () => {
  it('keeps each trade’s return, how many overlapped, and the balance curve in milliseconds', () => {
    const kept = keep(deviceAnswer())

    expect(kept.tradeReturns).toEqual([0.02, -0.01])
    expect(kept.overlappingTrades).toBe(1)
    expect(kept.curve[0]).toEqual([Date.parse('2025-01-06T05:00:00Z'), 1010])
  })

  it('keeps a Monte Carlo’s summary, each scenario’s final balance, and the real history’s path and prices beside its details', () => {
    const kept = keepScenarios(deviceAnswer(), scenariosAnswer(), summaryAnswer().summary)

    expect(kept.finals).toEqual([1020.1, 1004.9, 994.98])
    expect([kept.times.length, kept.real.length, kept.real.at(-1)]).toEqual([51, 51, 1004.95])
    expect([kept.priceTimes.length, kept.realPrices]).toEqual([3, [2000, 2010, 2005]])
    expect(kept.details?.paths).toHaveLength(3)
    expect(kept.details?.prices[0]).toEqual([2000, 2020, 2030])
  })

  it('says how many scenarios ended above the start, and by which method, for runs from before 2.2.0 too', () => {
    const now = { ...run(), monteCarlo: keepScenarios(deviceAnswer(), scenariosAnswer(), summaryAnswer().summary) }
    const before = { ...run(), result: { ...keep(deviceAnswer()), monteCarlo: { paths: 1000, endedAboveStartPercent: 61.2 } } }

    expect(endedAbove(now)).toEqual({ percent: 66.66666666666667, of: 3, method: 'bootstrap' })
    expect(endedAbove(before)).toEqual({ percent: 61.2, of: 1000, method: 'trade resampling' })
    expect(endedAbove(run())).toBeNull()
  })

  it('draws one point per time, the last balance when two trades closed on the same candle', () => {
    expect(curveByTime(keep(deviceAnswer()).curve)).toEqual([{ time: Date.parse('2025-01-06T05:00:00Z'), value: 1004.95 }])
  })

  it('reads how much of Kelly a sizing asks for', () => {
    expect([kellyShare('kelly'), kellyShare('kelly:50'), kellyShare('percent:50'), kellyShare(undefined)]).toEqual([100, 50, null, null])
  })
})

describe('the figures of a run', () => {
  it('heads with four figures and groups the rest', () => {
    const { headline, groups } = figuresOf(run())

    expect(headline.map((figure) => figure.label)).toEqual(['Profit / loss', 'Final balance', 'Win rate', 'Max drawdown'])
    expect(groups.map((group) => group.title)).toEqual(['Result', 'Trades', 'Risk', 'Sizing', 'Run'])
  })

  it('says why this run’s Kelly cannot be used, and counts overlapping trades', () => {
    const rows = new Map(figuresOf(run()).groups.flatMap((group) => group.rows))

    expect(rows.get('Kelly of this run')).toBe('not usable: only 2 closed trades (it needs at least 20)')
    expect(rows.get('Overlapping')).toBe('1 of 2 trades were open at the same time as another')
  })

  it('names the bot’s backtest a Kelly sizing came from', () => {
    const kelly = { estimate: deviceAnswer().kelly, shareOfKelly: 50, backtestId: 7, backtestedAt: '2026-11-08T12:00:00Z', from: '2019-01-02T00:00:00Z', to: '2026-11-08T12:00:00Z' }
    const rows = new Map(figuresOf(run(deviceAnswer({ sizing: { method: 'Kelly', value: 12.5, kelly } }))).groups.flatMap((group) => group.rows))

    expect(rows.get('Kelly from')).toMatch(/^the bot’s backtest #7/)
  })
})
