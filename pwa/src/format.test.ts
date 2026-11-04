import { describe, expect, it } from 'vitest'
import { fmtDuration, fmtElapsed, fmtMoney, fmtNumber, fmtPrice, fmtSignedMoney, fmtSignedPercent, fmtTime } from './format.ts'

describe('the app shows the bot’s digits (Format.cs)', () => {
  it('formats like the console', () => {
    expect(fmtPrice(2650.123456)).toBe('2,650.12346')
    expect(fmtPrice(null)).toBe('–')
    expect(fmtNumber(0.01)).toBe('0.01')
    expect(fmtMoney(1000, 'USD')).toBe('1,000.00 USD')
    expect(fmtMoney(1015.03, '')).toBe('1,015.03')
    expect(fmtSignedMoney(15.03, 'EUR')).toBe('+15.03 EUR')
    expect(fmtSignedMoney(-29.14)).toBe('-29.14')
    expect(fmtSignedMoney(0, 'EUR')).toBe('0.00 EUR')
    expect(fmtSignedPercent(1.5)).toBe('+1.50%')
    expect(fmtSignedPercent(-2.8)).toBe('-2.80%')
    expect(fmtSignedPercent(0)).toBe('0.00%')
    expect(fmtTime(Date.UTC(2026, 10, 3, 11, 0))).toBe('2026-11-03 11:00')
    expect(fmtDuration(3 * 86400 + 4 * 3600)).toBe('3d 4h')
    expect(fmtDuration(3900)).toBe('1h 05m')
    expect(fmtDuration(125)).toBe('2m 05s')
    expect(fmtDuration(-12)).toBe('12s')
    expect(fmtElapsed(184)).toBe('184 ms')
    expect(fmtElapsed(1240)).toBe('1.24 s')
  })
})
