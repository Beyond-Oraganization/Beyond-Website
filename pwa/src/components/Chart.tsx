import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { CandleRow } from '../api/parse/markets.ts'
import { useTheme } from '../theme.ts'

export type LinePoint = { time: number; value: number }
export type ChartLine = { name: string; points: LinePoint[]; dashed?: boolean; width?: 1 | 2 | 3 | 4 }

const seconds = (ms: number) => Math.round(ms / 1000) as UTCTimestamp

/** The surface's colours (the section-scoped tokens), read from the element so a theme change redraws them. */
function palette(element: HTMLElement) {
  const style = getComputedStyle(element)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return { fg: read('--fg', '#003049'), line: read('--line', 'rgba(0,48,73,.35)'), gain: read('--gain', '#0A5C2B'), loss: read('--loss', '#9B1B1B'), mute: read('--mute', '#1F4A60') }
}

/**
 * A price or balance chart in the website's language: no background of its own, the section's rules as the
 * grid, Plex Mono axes, gain and loss candles, navy lines (dashed for the envelope bands). TradingView's
 * attribution stays on, as lightweight-charts' licence asks.
 */
export function Chart({ candles, lines = [], label, height }: { candles?: CandleRow[]; lines?: ChartLine[]; label: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const element = box.current
    if (!element) return
    const colors = palette(element)
    const api = createChart(element, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: colors.fg, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: colors.line }, horzLines: { color: colors.line } },
      rightPriceScale: { borderColor: colors.fg },
      timeScale: { borderColor: colors.fg, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: colors.fg, labelBackgroundColor: colors.fg }, horzLine: { color: colors.fg, labelBackgroundColor: colors.fg } },
      localization: { locale: 'en-US' },
    })
    chart.current = api
    if (candles?.length) {
      const series = api.addSeries(CandlestickSeries, {
        upColor: colors.gain,
        downColor: colors.loss,
        borderUpColor: colors.gain,
        borderDownColor: colors.loss,
        wickUpColor: colors.gain,
        wickDownColor: colors.loss,
        priceLineColor: colors.fg,
      })
      series.setData(candles.map((c) => ({ time: seconds(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
    }
    for (const line of lines) {
      if (!line.points.length) continue
      const series = api.addSeries(LineSeries, {
        color: colors.fg,
        lineWidth: line.width ?? (line.dashed ? 1 : 2),
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: !line.dashed,
        crosshairMarkerVisible: !line.dashed,
        title: line.dashed ? '' : line.name,
      })
      series.setData(line.points.map((p) => ({ time: seconds(p.time), value: p.value })))
    }
    api.timeScale().fitContent()
    return () => {
      api.remove()
      chart.current = null
    }
  }, [candles, lines, theme])

  return <div ref={box} className="chart" role="img" aria-label={label} style={height ? { height } : undefined} />
}
