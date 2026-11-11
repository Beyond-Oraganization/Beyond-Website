import { describe, expect, it } from 'vitest'
import { timeTicks } from './charting.tsx'

const DAY = 86_400_000
const evenly = (from: string, days: number, points = 51) => Array.from({ length: points }, (_, i) => Date.parse(from) + (i * days * DAY) / (points - 1))

describe('a time axis', () => {
  it('labels days when ticks are days or weeks apart, never the same label twice', () => {
    const labels = timeTicks(evenly('2026-09-01T00:00:00Z', 70), 8).map((tick) => tick.label)

    expect(labels[0]).toBe('2026-09-01')
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('labels months, then years, as the ticks move further apart', () => {
    // The ticks fall on the 51 kept times, so the months they name are about two apart, not exactly.
    expect(timeTicks(evenly('2024-01-01T00:00:00Z', 365), 6).map((tick) => tick.label)).toEqual(['2024-01', '2024-02', '2024-05', '2024-07', '2024-08', '2024-11', '2024-12'])
    expect(timeTicks(evenly('2019-01-01T00:00:00Z', 365 * 7), 6).map((tick) => tick.label)).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025'])
  })
})
