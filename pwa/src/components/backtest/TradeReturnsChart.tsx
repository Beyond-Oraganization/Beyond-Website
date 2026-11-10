import { useId, useMemo, useRef, useState } from 'react'
import { niceTicks, returnBins, type ReturnBin } from '../../backtest/bins.ts'
import { fmtSignedPercent } from '../../format.ts'
import { plural } from '../../words.ts'
import { barPath, ChartTip, LossHatch, useWidth } from './charting.tsx'

const HEIGHT = 230
const M = { top: 22, right: 12, bottom: 30, left: 40 }
const percent = (fraction: number) => fmtSignedPercent(fraction * 100).replace(/\.00%$/, '%')

/**
 * How the trades' returns spread (the price move in each position's favour): losing trades left of 0 (hatched), winning
 * ones right of it, with the average loss and the average win marked. A trade that broke even sits at 0, grey.
 */
export function TradeReturnsChart({ returns, averageWin, averageLoss }: { returns: number[]; averageWin: number | null; averageLoss: number | null }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const hatch = useId().replace(/:/g, '')
  const [hover, setHover] = useState<{ bin: ReturnBin; x: number; y: number } | null>(null)
  const bins = useMemo(() => returnBins(returns), [returns])
  if (!bins.length) return null

  const lost = returns.filter((r) => r < 0).length
  const won = returns.filter((r) => r > 0).length
  const plotW = width - M.left - M.right
  const plotH = HEIGHT - M.top - M.bottom
  const lo = bins[0]!.from
  const hi = bins.at(-1)!.to
  const top = Math.max(...bins.map((bin) => bin.lost + bin.won + bin.even))
  const x = (value: number) => M.left + ((value - lo) / (hi - lo)) * plotW
  const y = (count: number) => M.top + plotH - (count / top) * plotH
  const yTicks = niceTicks(0, top, 4).filter((tick) => Number.isInteger(tick))
  const xTicks = niceTicks(lo, hi, Math.max(3, Math.floor(plotW / 90)))
  const label = `Returns of ${plural(returns.length, 'trade')}: ${lost} lost, ${won} won${averageLoss != null && lost ? `; average loss ${percent(-averageLoss)}` : ''}${averageWin != null && won ? `, average win ${percent(averageWin)}` : ''}.`

  return (
    <div className="stack-sm">
      <div ref={box} className="chart-box" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          <LossHatch id={hatch} />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={width - M.right} y1={y(tick)} y2={y(tick)} className="grid" />
              <text x={M.left - 8} y={y(tick)} className="tick" textAnchor="end" dominantBaseline="middle">
                {tick}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={tick} x={x(tick)} y={HEIGHT - 8} className="tick" textAnchor="middle">
              {percent(tick)}
            </text>
          ))}
          {bins.map((bin) => {
            const left = x(bin.from) + 1
            const barW = Math.max(1, x(bin.to) - x(bin.from) - 2)
            const total = bin.lost + bin.won + bin.even
            return (
              <g key={bin.from} onPointerEnter={(event) => setHover({ bin, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })}>
                {bin.even ? <path d={barPath(left, y(bin.even), barW, M.top + plotH - y(bin.even))} fill="var(--mute)" /> : null}
                {bin.lost ? <path d={barPath(left, y(bin.lost + bin.even), barW, y(bin.even) - y(bin.lost + bin.even))} fill={`url(#${hatch})`} /> : null}
                {bin.won ? <path d={barPath(left, y(total), barW, y(bin.even) - y(total))} fill="var(--gain)" /> : null}
                <rect x={x(bin.from)} y={M.top} width={x(bin.to) - x(bin.from)} height={plotH} fill="transparent" />
              </g>
            )
          })}
          <line x1={x(0)} x2={x(0)} y1={M.top - 6} y2={M.top + plotH} className="zero" />
          {averageLoss != null && lost ? <Average x={x(-averageLoss)} label={`avg loss ${percent(-averageLoss)}`} side="left" width={width} /> : null}
          {averageWin != null && won ? <Average x={x(averageWin)} label={`avg win ${percent(averageWin)}`} side="right" width={width} /> : null}
          <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} className="axis" />
        </svg>
        <ChartTip at={hover} width={width}>
          {hover ? (
            <>
              <strong>
                {percent(hover.bin.from)} to {percent(hover.bin.to)}
              </strong>
              <span>{[hover.bin.lost ? `${hover.bin.lost} lost` : '', hover.bin.even ? `${hover.bin.even} even` : '', hover.bin.won ? `${hover.bin.won} won` : ''].filter(Boolean).join(', ') || 'no trades'}</span>
            </>
          ) : null}
        </ChartTip>
      </div>
      <p className="chart-legend">
        <span>
          <i className="sq hatch" /> Losing trades ({lost})
        </span>
        <span>
          <i className="sq gain" /> Winning trades ({won})
        </span>
        {returns.length - lost - won ? (
          <span>
            <i className="sq mute" /> Broke even ({returns.length - lost - won})
          </span>
        ) : null}
        <span>
          <i className="dash" /> Average loss and win
        </span>
      </p>
    </div>
  )
}

/** A dashed line at an average, labelled on its `side` of the line, or on the other when the label would not fit. */
function Average({ x, label, side, width }: { x: number; label: string; side: 'left' | 'right'; width: number }) {
  const room = label.length * 6.8 + 8
  const left = side === 'left' ? x - room >= 0 : x + room > width
  return (
    <g>
      <line x1={x} x2={x} y1={M.top - 4} y2={HEIGHT - M.bottom} className="average" />
      <text x={left ? x - 5 : x + 5} y={M.top - 8} className="tick strong" textAnchor={left ? 'end' : 'start'}>
        {label}
      </text>
    </g>
  )
}
