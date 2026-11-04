/**
 * How numbers, money, times and durations look in the app: the same rules as the bot's Cli/Rendering/Format.cs
 * (invariant culture: "," groups thousands, "." is the decimal point, "–" means no value), so the app and the
 * console show the same digits.
 */
export const DASH = '–'

const grouped = (value: number, minFraction: number, maxFraction: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: minFraction, maximumFractionDigits: maxFraction })

/** "#,0.#####" */
export const fmtPrice = (value: number | null | undefined) => (value == null ? DASH : grouped(value, 0, 5))
/** "#,0.########" (quantities, volume, leverage) */
export const fmtNumber = (value: number | null | undefined) => (value == null ? DASH : grouped(value, 0, 8))
/** "#,0" */
export const fmtCount = (value: number | null | undefined) => (value == null ? DASH : grouped(Math.round(value), 0, 0))

/** "1,000.00 USD" (no currency: "1,000.00") */
export function fmtMoney(value: number | null | undefined, currency = ''): string {
  if (value == null) return DASH
  return `${grouped(value, 2, 2)} ${currency}`.trim()
}

/** "+15.03 USD" for a gain, "-29.14 USD" for a loss. */
export function fmtSignedMoney(value: number | null | undefined, currency = ''): string {
  if (value == null) return DASH
  return value > 0 ? `+${fmtMoney(value, currency)}` : fmtMoney(value, currency)
}

/** "+1.50%" / "-2.80%" / "0.00%" */
export function fmtSignedPercent(value: number | null | undefined): string {
  if (value == null) return DASH
  const text = `${value.toFixed(2)}%`
  return value > 0 ? `+${text}` : value === 0 ? '0.00%' : text
}

export const fmtPercent = (value: number | null | undefined, digits = 2) => (value == null ? DASH : `${value.toFixed(digits)}%`)

const pad = (value: number) => String(value).padStart(2, '0')

/** "yyyy-MM-dd HH:mm" in UTC. */
export function fmtTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** "HH:mm:ss" in UTC. */
export function fmtClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** "HH:mm" in UTC. */
export const fmtHourMinute = (ms: number | null | undefined) => (ms == null ? DASH : fmtClock(ms).slice(0, 5))

/** "3d 4h", "1h 05m", "2m 05s", "12s" (absolute value, like TimeSpan.Duration()). */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH
  const total = Math.abs(seconds)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = Math.floor(total % 60)
  if (days >= 1) return `${days}d ${hours}h`
  if (total >= 3600) return `${hours}h ${pad(minutes)}m`
  if (total >= 60) return `${minutes}m ${pad(secs)}s`
  return `${secs}s`
}

/** "184 ms", "1.24 s", then a duration. */
export function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return fmtDuration(ms / 1000)
}

export const fmtBytes = (bytes: number | null | undefined) => (bytes == null ? DASH : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** Up/down marker so a gain or loss is never told by colour alone. */
export const arrow = (value: number | null | undefined) => (value == null || value === 0 ? '' : value > 0 ? '▲ ' : '▼ ')

export const tone = (value: number | null | undefined): 'gain' | 'loss' | null => (value == null || value === 0 ? null : value > 0 ? 'gain' : 'loss')

/** "in 12m 05s" / "3m 10s ago" relative to now (both in ms). */
export function fmtRelative(ms: number, now = Date.now()): string {
  const seconds = (ms - now) / 1000
  return seconds >= 0 ? `in ${fmtDuration(seconds)}` : `${fmtDuration(seconds)} ago`
}
