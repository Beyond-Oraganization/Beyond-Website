import { describe, expect, it } from 'vitest'
import type { SessionSizing } from './api/types.ts'
import { kellyBasisWords, signalWords, sizingWords, splitSizing } from './words.ts'

const kelly = (shareOfKelly: number, value: number): SessionSizing => ({
  method: 'Kelly',
  value,
  kelly: {
    estimate: { trades: 400, wins: 180, losses: 220, averageWin: 0.012, averageLoss: 0.006, winProbability: 0.45, lossProbability: 0.55, payoffRatio: 2, percent: 17.5, whyUnusable: null },
    shareOfKelly,
    backtestId: 7,
    backtestedAt: '2026-11-08T12:00:00Z',
    from: '2019-01-02T00:00:00Z',
    to: '2026-11-08T12:00:00Z',
  },
})

describe('signalWords', () => {
  it('writes an open without a share since position sizing, and with it for an older bot', () => {
    expect(signalWords({ action: 'Open', side: 'Buy' })).toBe('open long')
    expect(signalWords({ action: 'Open', side: 'Sell', balanceShare: 0.5 })).toBe('open short (50% of balance)')
    expect(signalWords({ action: 'Close', side: 'Sell' })).toBe('close short')
  })
})

describe('sizingWords', () => {
  it('says each sizing as the bot does', () => {
    expect(sizingWords({ method: 'Percent', value: 25, kelly: null })).toBe('25% of the balance per position')
    expect(sizingWords({ method: 'Fixed', value: 500, kelly: null })).toBe('500.00 per position')
    expect(sizingWords(kelly(100, 17.5))).toBe('Kelly 17.5% of the balance per position')
    expect(sizingWords(kelly(50, 8.75))).toBe('Kelly, 50% of 17.5% = 8.75% of the balance per position')
  })

  it('a bot from before sizing always spent half the balance', () => {
    expect(sizingWords(undefined)).toBe('50% of the balance per position')
  })

  it('names the backtest behind a Kelly percent', () => {
    expect(kellyBasisWords(kelly(50, 8.75))).toBe('backtest #7: 400 trades, win rate 45.0%, payoff 2.00')
    expect(kellyBasisWords({ method: 'Percent', value: 25, kelly: null })).toBeNull()
  })
})

describe('splitSizing', () => {
  it('puts the number first and the words below it', () => {
    expect(splitSizing('50% of the balance per position')).toEqual({ value: '50%', sub: 'of the balance per position' })
    expect(splitSizing('500.00 per position')).toEqual({ value: '500.00', sub: 'per position' })
    expect(splitSizing('Kelly 17.5% of the balance per position')).toEqual({ value: 'Kelly 17.5%', sub: 'of the balance per position' })
    expect(splitSizing('Kelly, 50% of 17.5% = 8.75% of the balance per position')).toEqual({ value: '8.75%', sub: 'Kelly, 50% of 17.5%, of the balance per position' })
    expect(splitSizing('something else')).toEqual({ value: 'something else', sub: '' })
  })
})
