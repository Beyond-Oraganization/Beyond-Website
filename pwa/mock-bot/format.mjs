// The bot's Cli/Rendering/Format.cs, written again for the mock bot (independently of the app's readers, so the
// tests compare two implementations of the same rules).
const grouped = (value, min, max) => value.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })
export const DASH = '–'
export const price = (value) => (value == null ? DASH : grouped(value, 0, 5))
export const number = (value) => (value == null ? DASH : grouped(value, 0, 8))
export const count = (value) => grouped(Math.round(value), 0, 0)
export const money = (value, currency = '') => (value == null ? DASH : `${grouped(value, 2, 2)} ${currency}`.trim())
export const signedMoney = (value, currency = '') => (value == null ? DASH : value > 0 ? `+${money(value, currency)}` : money(value, currency))
export const signedPercent = (value) => (value == null ? DASH : value > 0 ? `+${value.toFixed(2)}%` : value < 0 ? `${value.toFixed(2)}%` : '0.00%')
export const percent = (value, digits = 2) => `${value.toFixed(digits)}%`
const pad = (value) => String(value).padStart(2, '0')
export const time = (ms) => {
  if (ms == null) return DASH
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export const clock = (ms) => {
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
export const hhmm = (ms) => clock(ms).slice(0, 5)
export function duration(seconds) {
  if (seconds == null) return DASH
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
export const elapsed = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(2)} s` : duration(ms / 1000))
export const bytes = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`
/** .NET TimeSpan "c" format. */
export function span(ms) {
  const negative = ms < 0
  let rest = Math.abs(ms)
  const days = Math.floor(rest / 86400000)
  rest -= days * 86400000
  const hours = Math.floor(rest / 3600000)
  rest -= hours * 3600000
  const minutes = Math.floor(rest / 60000)
  rest -= minutes * 60000
  const seconds = Math.floor(rest / 1000)
  const ticks = Math.round((rest - seconds * 1000) * 10000)
  const fraction = ticks ? `.${String(ticks).padStart(7, '0')}` : ''
  return `${negative ? '-' : ''}${days ? `${days}.` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}${fraction}`
}
/** decimal.ToString("0.########") */
export const plain = (value) => value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 8 })
