import { describe, expect, it } from 'vitest'
import { deviceAnswer } from './fixtures.ts'
import { figuresOf } from './figures.ts'
import { curveByTime, forStorage, keep, kellyShare, pathByTrade, type DeviceRun } from './runs.ts'

const run = (answer = deviceAnswer()): DeviceRun => ({
  kind: 'device', id: '1', at: 0, input: { strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', params: {} }, balance: 1000, from: null, to: null, paths: 3, result: keep(answer),
})

describe('a device backtest as the page keeps it', () => {
  it('keeps each trade’s return, how many overlapped, and the balance curve in milliseconds', () => {
    const kept = keep(deviceAnswer())

    expect(kept.tradeReturns).toEqual([0.02, -0.01])
    expect(kept.overlappingTrades).toBe(1)
    expect(kept.curve[0]).toEqual([Date.parse('2025-01-06T05:00:00Z'), 1010])
    expect(kept.monteCarlo?.finals).toEqual([1020.1, 1004.95, 994.98])
  })

  it('is saved without the Monte Carlo’s paths, keeping their final balances', () => {
    const saved = forStorage(run())

    expect(saved.result.monteCarlo?.pathPoints).toBeNull()
    expect(saved.result.monteCarlo?.finals).toHaveLength(3)
  })

  it('draws one point per time, the last balance when two trades closed on the same candle', () => {
    expect(curveByTime(keep(deviceAnswer()).curve)).toEqual([{ time: Date.parse('2025-01-06T05:00:00Z'), value: 1004.95 }])
  })

  it('walks its own path by trade number, from the starting balance', () => {
    expect(pathByTrade(keep(deviceAnswer()))).toEqual([1000, 1010, 1004.95])
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
