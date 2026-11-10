/** Bins and axis ticks for the Backtest page's charts: pure, so they are tested apart from drawing. */

/**
 * A step of 1, 2 or 5 × 10ⁿ that splits `span` into about `parts` parts: at most that many when rounding `up` (bins),
 * the closest count when rounding to the `nearest` (axis ticks).
 */
export function niceStep(span: number, parts: number, round: 'up' | 'nearest' = 'up'): number {
  if (!(span > 0) || !(parts > 0)) return 1
  const raw = span / parts
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const nice =
    round === 'up' ? (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) : fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
  return nice * power
}

/** Round-numbered ticks from `min` to `max`, about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const step = niceStep(max - min, count, 'nearest')
  const ticks: number[] = []
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)))
  return ticks
}

/** One bin of trade returns: from `from` up to `to`, with how many trades lost, broke even and won in it. */
export type ReturnBin = { from: number; to: number; lost: number; even: number; won: number }

/**
 * Bins trade returns (0.012 is +1.2 %) with 0 always on a bin edge, so a bin holds losses or wins, never both.
 * A trade that broke even counts in the bin that starts at 0.
 */
export function returnBins(returns: number[], targetBins = 24): ReturnBin[] {
  if (!returns.length) return []
  const low = Math.min(0, ...returns)
  const high = Math.max(0, ...returns)
  const width = niceStep(high - low || 0.01, targetBins)
  const first = Math.floor(low / width)
  const last = Math.max(first + 1, Math.floor(high / width) + 1)
  const bins: ReturnBin[] = []
  for (let k = first; k < last; k++) bins.push({ from: k * width, to: (k + 1) * width, lost: 0, even: 0, won: 0 })
  for (const value of returns) {
    const bin = bins[Math.min(bins.length - 1, Math.floor(value / width) - first)]!
    if (value < 0) bin.lost++
    else if (value > 0) bin.won++
    else bin.even++
  }
  return bins
}

/** One bin of final balances. */
export type ValueBin = { from: number; to: number; count: number }

/** Bins values into `count` equal bins over [`min`, `max`] (the chart's own y range, so bars line up with its axis). */
export function valueBins(values: number[], min: number, max: number, count: number): ValueBin[] {
  const width = (max - min) / count
  const bins = Array.from({ length: count }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }))
  if (!(width > 0)) return bins
  for (const value of values) bins[Math.max(0, Math.min(count - 1, Math.floor((value - min) / width)))]!.count++
  return bins
}

/** The smallest and largest of every series, padded by `pad` of the span (a flat set gets ±1 %). */
export function extent(series: number[][], pad = 0.03): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const values of series) for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min)) return [0, 1]
  const span = max - min || Math.abs(max) * 0.02 || 1
  return [min - span * pad, max + span * pad]
}
