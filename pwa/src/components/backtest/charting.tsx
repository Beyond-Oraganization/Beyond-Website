import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { useTheme } from '../../theme.ts'

/**
 * The inner width of an element (inside its border, whole pixels), following it as it resizes; 720 before it is
 * measured, or without ResizeObserver. Never the outer width: a drawing that wide would widen the box it measures,
 * and the two would grow without end.
 */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(720)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.max(240, Math.floor(element.clientWidth) || 720))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export type ChartColors = { fg: string; bg: string; line: string; mute: string; gain: string; loss: string }

/**
 * The section's colours (the tokens every component reads), for the canvas, which cannot read CSS variables. Read
 * again when the theme changes.
 */
export function useChartColors(ref: RefObject<HTMLElement | null>): ChartColors {
  const { theme } = useTheme()
  const [colors, setColors] = useState<ChartColors>({ fg: '#003049', bg: '#FCBF49', line: 'rgba(0,48,73,.35)', mute: '#1F4A60', gain: '#0A5C2B', loss: '#9B1B1B' })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const style = getComputedStyle(element)
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
    setColors({ fg: read('--fg', '#003049'), bg: read('--bg', '#FCBF49'), line: read('--line', 'rgba(0,48,73,.35)'), mute: read('--mute', '#1F4A60'), gain: read('--gain', '#0A5C2B'), loss: read('--loss', '#9B1B1B') })
  }, [ref, theme])
  return colors
}

/**
 * The hatch on losing bars. Red and green alone fail the deuteranopia check on the app's surfaces (ΔE 5.8), so
 * losses are told apart by the hatch and by where they sit (left of 0, below the start), not by colour alone.
 */
export function LossHatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--loss)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bg)" strokeWidth="2" strokeOpacity="0.55" />
      </pattern>
    </defs>
  )
}

/** A bar whose data end is rounded and whose base is square, `horizontal` ones growing to the right. */
export function barPath(x: number, y: number, width: number, height: number, horizontal = false, radius = 3): string {
  if (width <= 0 || height <= 0) return ''
  if (horizontal) {
    const r = Math.min(radius, width, height / 2)
    return `M${x},${y}h${width - r}a${r},${r} 0 0 1 ${r},${r}v${height - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${width - r}z`
  }
  const r = Math.min(radius, height, width / 2)
  return `M${x},${y + height}v-${height - r}a${r},${r} 0 0 1 ${r},-${r}h${width - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${height - r}z`
}

/** The hover note over a chart, kept inside it. */
export function ChartTip({ at, width, children }: { at: { x: number; y: number } | null; width: number; children: ReactNode }) {
  if (!at) return null
  const left = Math.min(Math.max(at.x + 12, 4), width - 230)
  return (
    <div className="chart-tip" style={{ left, top: Math.max(4, at.y - 48) }} role="status">
      {children}
    </div>
  )
}
