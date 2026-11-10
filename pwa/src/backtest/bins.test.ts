import { describe, expect, it } from 'vitest'
import { extent, niceStep, niceTicks, returnBins, valueBins } from './bins.ts'

describe('chart bins and ticks', () => {
  it('steps by 1, 2 or 5 times a power of ten', () => {
    expect([niceStep(10, 5), niceStep(0.07, 24), niceStep(900, 4)]).toEqual([2, 0.005, 500])
  })

  it('puts ticks on round numbers inside the range', () => {
    expect(niceTicks(937, 1213, 5)).toEqual([950, 1000, 1050, 1100, 1150, 1200])
  })

  it('keeps 0 on a bin edge, so no bin holds both losses and wins', () => {
    const bins = returnBins([-0.012, -0.004, 0.003, 0.021, 0.0005])

    expect(bins.every((bin) => bin.lost === 0 || bin.won === 0)).toBe(true)
    expect(bins.some((bin) => bin.from === 0)).toBe(true)
    expect(bins.reduce((sum, bin) => sum + bin.lost + bin.won + bin.even, 0)).toBe(5)
  })

  it('counts a trade that broke even apart, in the bin that starts at 0', () => {
    const bins = returnBins([0, 0.01, -0.01])

    expect(bins.find((bin) => bin.from === 0)).toMatchObject({ even: 1, won: 0 })
  })

  it('has no bins without trades', () => {
    expect(returnBins([])).toEqual([])
  })

  it('bins final balances on the chart’s own range, the top value in the top bin', () => {
    const bins = valueBins([900, 950, 1000, 1100], 900, 1100, 4)

    expect(bins.map((bin) => bin.count)).toEqual([1, 1, 1, 1])
    expect(bins[3]).toMatchObject({ from: 1050, to: 1100 })
  })

  it('pads the range of every series, and widens a flat one', () => {
    expect(extent([[1000, 1100], [900]], 0.1)).toEqual([880, 1120])
    expect(extent([[1000, 1000]])[0]).toBeLessThan(1000)
  })
})
