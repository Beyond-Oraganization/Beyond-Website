import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { extent, niceTicks, valueBins, type ValueBin } from '../../backtest/bins.ts'
import { fmtCount, fmtMoney } from '../../format.ts'
import { barPath, ChartTip, LossHatch, useChartColors, useWidth } from './charting.tsx'

const M = { top: 14, bottom: 30, left: 58 }
const GAP = 14
const compact = (value: number) => (Math.abs(value) >= 10_000 ? `${(value / 1000).toFixed(Math.abs(value) >= 100_000 ? 0 : 1)}k` : fmtCount(value))

export type MonteCarloChartProps = {
  start: number
  /** Trade numbers (0 is the start) at which the paths are kept. */
  pointTrades: number[]
  meanPath: number[]
  /** Every path at the point trades; null for a saved run, which keeps only the final balances. */
  pathPoints: number[][] | null
  finals: number[]
  meanFinal: number
  /** The backtest's own balance by trade number, from the start. */
  backtest: number[]
}

/**
 * Every simulated balance path, faint, with the average path in bold and the backtest's own dashed; on the right, on
 * the same scale, how the paths ended (above the start in the gain colour, below it hatched) with a dot at the mean.
 * The paths are drawn on a canvas (a thousand SVG lines are slow on a phone); the rest is SVG.
 */
export function MonteCarloChart({ start, pointTrades, meanPath, pathPoints, finals, meanFinal, backtest }: MonteCarloChartProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const width = useWidth(box)
  const colors = useChartColors(box)
  const hatch = useId().replace(/:/g, '')
  const [hover, setHover] = useState<{ x: number; y: number; text: [string, string] } | null>(null)

  const height = width < 600 ? 280 : 360
  const side = Math.round(Math.min(170, Math.max(90, width * 0.2)))
  const plotW = width - M.left - GAP - side
  const plotH = height - M.top - M.bottom
  const trades = pointTrades.at(-1) ?? 0
  const [lo, hi] = useMemo(() => extent([finals, meanPath, backtest, [start], ...(pathPoints ?? [])]), [finals, meanPath, backtest, start, pathPoints])
  const x = (trade: number) => M.left + (trades ? (trade / trades) * plotW : 0)
  const y = (balance: number) => M.top + plotH - ((balance - lo) / (hi - lo)) * plotH
  const bins = useMemo(() => valueBins(finals, lo, hi, Math.max(12, Math.min(40, Math.round(plotH / 9)))), [finals, lo, hi, plotH])
  const most = Math.max(1, ...bins.map((bin) => bin.count))
  const sideX = M.left + plotW + GAP
  const barLength = (bin: ValueBin) => (bin.count / most) * (side - 8)
  const above = finals.filter((final) => final > start).length

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    if (!pathPoints?.length) return
    // Fainter the more paths there are, so where many cross still reads darker than where few do.
    context.globalAlpha = Math.min(0.35, Math.max(0.035, 1.5 / Math.sqrt(pathPoints.length)))
    context.strokeStyle = colors.fg
    context.lineWidth = 1
    context.lineJoin = 'round'
    for (const path of pathPoints) {
      context.beginPath()
      path.forEach((balance, point) => (point ? context.lineTo(x(pointTrades[point]!), y(balance)) : context.moveTo(x(pointTrades[point]!), y(balance))))
      context.stroke()
    }
    // x and y read only the layout values in this effect's dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathPoints, pointTrades, width, height, lo, hi, colors.fg])

  const line = (values: number[], at: (index: number) => number) => values.map((value, index) => `${index ? 'L' : 'M'}${at(index).toFixed(1)},${y(value).toFixed(1)}`).join('')
  const meanLine = line(meanPath, (index) => x(pointTrades[index]!))
  const ownLine = line(backtest, (index) => x(index))
  const yTicks = niceTicks(lo, hi, Math.max(3, Math.round(plotH / 60)))
  const xTicks = niceTicks(0, trades, Math.max(2, Math.floor(plotW / 90))).filter((tick) => Number.isInteger(tick))

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const { offsetX, offsetY } = event.nativeEvent
    if (offsetX <= M.left + plotW) {
      const trade = Math.max(0, Math.min(trades, ((offsetX - M.left) / plotW) * trades))
      const point = pointTrades.reduce((best, candidate, index) => (Math.abs(candidate - trade) < Math.abs(pointTrades[best]! - trade) ? index : best), 0)
      const at = pointTrades[point]!
      setHover({ x: x(at), y: offsetY, text: [`Trade ${fmtCount(at)} of ${fmtCount(trades)}`, `Average ${fmtMoney(meanPath[point])}${backtest[at] != null ? ` · this backtest ${fmtMoney(backtest[at])}` : ''}`] })
    } else {
      const bin = bins.find((candidate) => y(candidate.from) >= offsetY && y(candidate.to) <= offsetY)
      setHover(bin ? { x: offsetX - 220, y: offsetY, text: [`${fmtMoney(bin.from)} to ${fmtMoney(bin.to)}`, `${fmtCount(bin.count)} paths (${((bin.count / finals.length) * 100).toFixed(1)}%)`] } : null)
    }
  }

  const label =
    `${fmtCount(finals.length)} simulated balance paths of ${fmtCount(trades)} trades from ${fmtMoney(start)}: ` +
    `${fmtCount(above)} ended above the start; they ended from ${fmtMoney(Math.min(...finals))} to ${fmtMoney(Math.max(...finals))}, ${fmtMoney(meanFinal)} on average.`

  return (
    <div className="stack-sm">
      <div ref={box} className="chart-box mc" style={{ height }} onPointerLeave={() => setHover(null)}>
        <canvas ref={canvas} style={{ width, height }} aria-hidden="true" />
        <svg width={width} height={height} role="img" aria-label={label}>
          <LossHatch id={hatch} />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={sideX + side} y1={y(tick)} y2={y(tick)} className="grid" />
              <text x={M.left - 8} y={y(tick)} className="tick" textAnchor="end" dominantBaseline="middle">
                {compact(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={tick} x={x(tick)} y={height - 8} className="tick" textAnchor="middle">
              {fmtCount(tick)}
            </text>
          ))}
          <text x={M.left + plotW} y={height - 8} className="tick" textAnchor="end" dy="-14">
            trade
          </text>
          <line x1={M.left} x2={sideX + side} y1={y(start)} y2={y(start)} className="start" />
          <text x={M.left + 6} y={y(start) - 6} className="tick strong">
            start {fmtMoney(start)}
          </text>
          {backtest.length > 1 ? <path d={ownLine} className="own" /> : null}
          <path d={meanLine} className="mean-halo" />
          <path d={meanLine} className="mean" />
          <line x1={sideX} x2={sideX} y1={M.top} y2={M.top + plotH} className="axis" />
          {bins.map((bin) =>
            bin.count ? (
              <path
                key={bin.from}
                d={barPath(sideX, y(bin.to) + 1, barLength(bin), Math.max(1, y(bin.from) - y(bin.to) - 2), true)}
                fill={(bin.from + bin.to) / 2 > start ? 'var(--gain)' : `url(#${hatch})`}
              />
            ) : null,
          )}
          <line x1={x(trades)} x2={sideX} y1={y(meanPath.at(-1) ?? meanFinal)} y2={y(meanFinal)} className="connector" />
          <circle cx={sideX} cy={y(meanFinal)} r={6} className="mean-dot" />
          <text x={sideX + 10} y={y(meanFinal) - 10} className="tick strong">
            mean {compact(meanFinal)}
          </text>
          <text x={sideX + side - 4} y={height - 8} className="tick" textAnchor="end">
            final balances
          </text>
          <rect x={M.left} y={M.top} width={plotW + GAP + side} height={plotH} fill="transparent" onPointerMove={onMove} />
          {hover && hover.x >= M.left && hover.x <= M.left + plotW ? <line x1={hover.x} x2={hover.x} y1={M.top} y2={M.top + plotH} className="cross" /> : null}
        </svg>
        <ChartTip at={hover} width={width}>
          {hover ? (
            <>
              <strong>{hover.text[0]}</strong>
              <span>{hover.text[1]}</span>
            </>
          ) : null}
        </ChartTip>
      </div>
      <p className="chart-legend">
        {pathPoints ? (
          <span>
            <i className="thin" /> One simulated path
          </span>
        ) : null}
        <span>
          <i className="thick" /> Average path
        </span>
        <span>
          <i className="dash" /> This backtest
        </span>
        <span>
          <i className="sq gain" /> Ended above the start
        </span>
        <span>
          <i className="sq hatch" /> Ended below it
        </span>
        <span>
          <i className="dot" /> Mean final balance
        </span>
      </p>
    </div>
  )
}
