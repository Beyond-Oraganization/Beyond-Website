import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { extent, niceTicks } from '../../backtest/bins.ts'
import { fmtPrice, fmtTime } from '../../format.ts'
import { ChartTip, timeTicks, useWidth } from './charting.tsx'

const M = { top: 14, bottom: 30, left: 64, right: 12 }

export type PricePathsChartProps = {
  /** The candles drawn (ms): the one before the first made-up candle, to the last. */
  times: number[]
  /** The real closes at those times. */
  real: number[]
  /** Some scenarios' closes at the same times; null when this device did not keep them. */
  paths: number[][] | null
}

/**
 * A few alternative price histories, faint, around the real one in bold: to see that the made-up paths look like
 * the market they came from. The scale is shared, so a path that wanders far shows as far.
 */
export function PricePathsChart({ times, real, paths }: PricePathsChartProps) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const [hover, setHover] = useState<{ x: number; y: number; point: number } | null>(null)
  const height = width < 600 ? 220 : 280
  const plotW = width - M.left - M.right
  const plotH = height - M.top - M.bottom
  const last = Math.max(1, times.length - 1)
  const [lo, hi] = useMemo(() => extent([real, ...(paths ?? [])]), [real, paths])
  const x = (point: number) => M.left + (point / last) * plotW
  const y = (price: number) => M.top + plotH - ((price - lo) / (hi - lo)) * plotH
  const line = (values: number[]) => values.map((value, point) => `${point ? 'L' : 'M'}${x(point).toFixed(1)},${y(value).toFixed(1)}`).join('')
  const yTicks = niceTicks(lo, hi, Math.max(3, Math.round(plotH / 55)))
  const xTicks = timeTicks(times, Math.max(2, Math.floor(plotW / 110)))

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const point = Math.round(Math.max(0, Math.min(1, (event.nativeEvent.offsetX - M.left) / plotW)) * last)
    setHover({ x: x(point), y: event.nativeEvent.offsetY, point })
  }
  const at = hover ? (paths ?? []).map((path) => path[hover.point]!).filter(Number.isFinite) : []
  const label = `The real price from ${fmtPrice(real[0])} to ${fmtPrice(real.at(-1))}${paths ? `, and ${paths.length} alternative histories ending from ${fmtPrice(Math.min(...paths.map((path) => path.at(-1)!)))} to ${fmtPrice(Math.max(...paths.map((path) => path.at(-1)!)))}` : ''}.`

  return (
    <div className="stack-sm">
      <div ref={box} className="chart-box" style={{ height }} onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={label}>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={M.left + plotW} y1={y(tick)} y2={y(tick)} className="grid" />
              <text x={M.left - 8} y={y(tick)} className="tick" textAnchor="end" dominantBaseline="middle">
                {fmtPrice(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick, index) => (
            <text key={tick.index} x={x(tick.index)} y={height - 8} className="tick" textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}>
              {tick.label}
            </text>
          ))}
          {(paths ?? []).map((path, index) => (
            <path key={index} d={line(path)} className="price-path" />
          ))}
          <path d={line(real)} className="mean-halo" />
          <path d={line(real)} className="price-real" />
          <rect x={M.left} y={M.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} />
          {hover ? <line x1={hover.x} x2={hover.x} y1={M.top} y2={M.top + plotH} className="cross" /> : null}
        </svg>
        <ChartTip at={hover} width={width}>
          {hover ? (
            <>
              <strong>{fmtTime(times[hover.point])} UTC</strong>
              <span>
                Real {fmtPrice(real[hover.point])}
                {at.length ? ` · the others ${fmtPrice(Math.min(...at))} to ${fmtPrice(Math.max(...at))}` : ''}
              </span>
            </>
          ) : null}
        </ChartTip>
      </div>
      <p className="chart-legend">
        {paths ? (
          <span>
            <i className="thin" /> One alternative history
          </span>
        ) : null}
        <span>
          <i className="thick" /> The real price
        </span>
      </p>
    </div>
  )
}
