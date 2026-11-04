/**
 * Reads the bot's formatted values back into numbers: the inverse of Cli/Rendering/Format.cs. Every reader
 * returns null for the bot's "–" (no value) and for anything it does not recognise, never a wrong number.
 */
const DASH = '–'
const clean = (text: string | null | undefined) => (text ?? '').trim()

const NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

/** "1,234.5", "-0.00001", "+15.03" */
export function parseNumber(text: string | null | undefined): number | null {
  const value = clean(text).replace(/−/g, '-')
  if (!value || value === DASH || !NUMBER.test(value)) return null
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? number : null
}

/** "1,000.00 USD", "+15.03 EUR", "-29.14", "0.00" */
export function parseMoney(text: string | null | undefined): { amount: number; currency: string } | null {
  const match = /^([+-]?[\d,]+(?:\.\d+)?)(?:\s+(\S+))?$/.exec(clean(text))
  if (!match) return null
  const amount = parseNumber(match[1])
  return amount == null ? null : { amount, currency: match[2] ?? '' }
}

/** "+1.50%", "28.8%", "-2.80%" */
export function parsePercent(text: string | null | undefined): number | null {
  const match = /^([+-]?[\d,]+(?:\.\d+)?)\s*%$/.exec(clean(text))
  return match ? parseNumber(match[1]) : null
}

/** "yyyy-MM-dd HH:mm" (optionally "… UTC") as epoch milliseconds, UTC. */
export function parseTime(text: string | null | undefined): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?: UTC)?$/.exec(clean(text))
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number]
  return Date.UTC(y, mo - 1, d, h, mi)
}

/** "3d 4h", "1h 05m", "2m 05s", "12s" as seconds. */
export function parseDuration(text: string | null | undefined): number | null {
  const value = clean(text)
  let match = /^(\d+)d (\d+)h$/.exec(value)
  if (match) return Number(match[1]) * 86400 + Number(match[2]) * 3600
  match = /^(\d+)h (\d+)m$/.exec(value)
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60
  match = /^(\d+)m (\d+)s$/.exec(value)
  if (match) return Number(match[1]) * 60 + Number(match[2])
  match = /^(\d+)s$/.exec(value)
  return match ? Number(match[1]) : null
}

/** "184 ms", "1.24 s", or a duration, as milliseconds. */
export function parseElapsed(text: string | null | undefined): number | null {
  const value = clean(text)
  let match = /^([\d.]+) ms$/.exec(value)
  if (match) return Number(match[1])
  match = /^([\d.]+) s$/.exec(value)
  if (match) return Number(match[1]) * 1000
  const seconds = parseDuration(value)
  return seconds == null ? null : seconds * 1000
}

/** "45.3 MB" as bytes. */
export function parseBytes(text: string | null | undefined): number | null {
  const match = /^([\d.]+) MB$/.exec(clean(text))
  return match ? Number(match[1]) * 1024 * 1024 : null
}

/** .NET TimeSpan "c" format, "[-][d.]hh:mm:ss[.fffffff]", as seconds (session --json durations). */
export function parseTimeSpan(text: string | null | undefined): number | null {
  const match = /^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(clean(text))
  if (!match) return null
  const [, minus, days, hours, minutes, seconds, fraction] = match
  const total =
    Number(days ?? 0) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0)
  return minus ? -total : total
}

/** ISO 8601 time as epoch ms, or null. */
export function parseIso(text: string | null | undefined): number | null {
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : ms
}
