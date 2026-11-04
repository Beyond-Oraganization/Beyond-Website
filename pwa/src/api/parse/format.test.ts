import { describe, expect, it } from 'vitest'
import { parseBytes, parseDuration, parseElapsed, parseMoney, parseNumber, parsePercent, parseTime, parseTimeSpan } from './format.ts'

describe('readers of Cli/Rendering/Format.cs', () => {
  it('numbers', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('2,650.12')).toBe(2650.12)
    expect(parseNumber('-0.00001')).toBe(-0.00001)
    expect(parseNumber('+15.03')).toBe(15.03)
    expect(parseNumber('45,123')).toBe(45123)
    expect(parseNumber('–')).toBeNull()
    expect(parseNumber('12a')).toBeNull()
    expect(parseNumber('1,23')).toBeNull()
  })
  it('money', () => {
    expect(parseMoney('1,000.00 USD')).toEqual({ amount: 1000, currency: 'USD' })
    expect(parseMoney('+15.03 EUR')).toEqual({ amount: 15.03, currency: 'EUR' })
    expect(parseMoney('-29.14')).toEqual({ amount: -29.14, currency: '' })
    expect(parseMoney('–')).toBeNull()
  })
  it('percent', () => {
    expect(parsePercent('+1.50%')).toBe(1.5)
    expect(parsePercent('-2.80%')).toBe(-2.8)
    expect(parsePercent('28.8%')).toBe(28.8)
    expect(parsePercent('–')).toBeNull()
  })
  it('times, as UTC', () => {
    expect(parseTime('2026-11-03 11:00')).toBe(Date.UTC(2026, 10, 3, 11, 0))
    expect(parseTime('2025-03-30 08:00 UTC')).toBe(Date.UTC(2025, 2, 30, 8, 0))
    expect(parseTime('–')).toBeNull()
  })
  it('durations and elapsed times', () => {
    expect(parseDuration('3d 4h')).toBe(3 * 86400 + 4 * 3600)
    expect(parseDuration('1h 05m')).toBe(3900)
    expect(parseDuration('2m 05s')).toBe(125)
    expect(parseDuration('12s')).toBe(12)
    expect(parseDuration('–')).toBeNull()
    expect(parseElapsed('184 ms')).toBe(184)
    expect(parseElapsed('1.24 s')).toBe(1240)
    expect(parseElapsed('2m 05s')).toBe(125000)
    expect(parseBytes('45.3 MB')).toBeCloseTo(45.3 * 1024 * 1024)
  })
  it('.NET TimeSpan "c" format', () => {
    expect(parseTimeSpan('00:00:00.1840000')).toBeCloseTo(0.184)
    expect(parseTimeSpan('3.04:05:06.7890000')).toBeCloseTo(3 * 86400 + 4 * 3600 + 5 * 60 + 6.789)
    expect(parseTimeSpan('-00:01:00')).toBe(-60)
    expect(parseTimeSpan('nope')).toBeNull()
  })
})
