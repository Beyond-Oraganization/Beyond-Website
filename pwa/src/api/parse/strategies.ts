import { z } from 'zod'
import type { CommandResult, SectionBlock } from '../types.ts'
import { findGrid, findSection, findTable, gridMap, parsed, rowsOf, sections, topLines, unreadable, type Parsed } from './blocks.ts'
import { parseElapsed, parseMoney, parseNumber, parsePercent, parseTime } from './format.ts'

export type StrategyParameter = { name: string; default: number; min: number; max: number; meaning: string; whole: boolean }
/** The rules a strategy trades by when none are given, tried in order, and how its rules are written. */
export type StrategyRules = { defaults: string[]; syntax: string }
export type StrategyDefinition = {
  name: string
  title: string
  description: string
  defaultMarket: { symbol: string; interval: string } | null
  parameters: StrategyParameter[]
  /** Null for a bot from before rules (it has no --json catalog): the app then sends none. */
  rules: StrategyRules | null
}

/** `strategies --json` (Cli/Rendering/StrategyCatalogJson.cs), camelCase. */
const catalogJson = z.array(
  z.object({
    name: z.string().min(1),
    title: z.string(),
    description: z.string(),
    symbol: z.string().nullish(),
    interval: z.string().nullish(),
    parameters: z.array(
      z.object({
        name: z.string().min(1),
        description: z.string().nullish(),
        default: z.number(),
        minimum: z.number(),
        maximum: z.number(),
        wholeNumber: z.boolean().nullish(),
      }),
    ),
    rules: z.object({ defaults: z.array(z.string()), syntax: z.string() }).nullish(),
  }),
)

/**
 * The strategy catalog. A bot with rules answers `strategies --json`, which says everything a form needs; an
 * older bot (no --json) prints panels, read by {@link parseStrategies}. Nothing here knows any strategy.
 */
export function parseStrategyCatalog(result: CommandResult): Parsed<StrategyDefinition[]> {
  if (result.json == null) return parseStrategies(result)
  const read = catalogJson.safeParse(result.json)
  if (!read.success) return unreadable(`Unreadable strategy catalog: ${read.error.issues[0]?.message ?? 'unexpected shape'}.`)
  return parsed(
    read.data.map((strategy) => ({
      name: strategy.name,
      title: strategy.title,
      description: strategy.description,
      defaultMarket: strategy.symbol && strategy.interval ? { symbol: strategy.symbol, interval: strategy.interval } : null,
      parameters: strategy.parameters.map((p) => ({
        name: p.name,
        default: p.default,
        min: p.minimum,
        max: p.maximum,
        meaning: p.description ?? '',
        whole: p.wholeNumber ?? [p.default, p.minimum, p.maximum].every(Number.isInteger),
      })),
      rules: strategy.rules ? { defaults: strategy.rules.defaults, syntax: strategy.rules.syntax } : null,
    })),
  )
}

/**
 * `strategies` of a bot without rules: one panel per strategy titled "drcs – Double Red Cross" (en dash), holding
 * the description, "Default market: XAUUSD 1h" and a Parameter / Default / Range / Meaning table, the range written
 * "1–500". The bot does not print whether a parameter is a whole number; integer bounds and default mean it is.
 */
export function parseStrategies(result: CommandResult): Parsed<StrategyDefinition[]> {
  const panels = sections(result.blocks, (title) => / [–-] /.test(title))
  if (!panels.length) return unreadable('No strategy panels in the answer.')
  const definitions: StrategyDefinition[] = []
  for (const panel of panels) {
    const [name, ...titleParts] = panel.title.split(/ [–-] /)
    const text = topLines(panel.blocks)
    const marketLine = text.find((line) => line.startsWith('Default market:'))
    const market = marketLine ? /^Default market:\s*(\S+)\s+(\S+)$/.exec(marketLine) : null
    const table = findTable(panel.blocks, ['Parameter', 'Default', 'Range'])
    if (!name || !table) return unreadable(`Unreadable strategy panel: ${panel.title}`)
    const parameters: StrategyParameter[] = []
    for (const row of rowsOf(table)) {
      const range = /^(-?[\d,.]+)\s*[–-]\s*(-?[\d,.]+)$/.exec(row.Range ?? '')
      const value = parseNumber(row.Default)
      const min = parseNumber(range?.[1])
      const max = parseNumber(range?.[2])
      if (!row.Parameter || value == null || min == null || max == null) return unreadable(`Unreadable parameter row in ${panel.title}`)
      parameters.push({ name: row.Parameter, default: value, min, max, meaning: row.Meaning ?? '', whole: [value, min, max].every(Number.isInteger) })
    }
    definitions.push({
      name: name.trim(),
      title: titleParts.join(' – ').trim(),
      description: text.filter((line) => line !== marketLine).join(' '),
      defaultMarket: market ? { symbol: market[1] ?? '', interval: market[2] ?? '' } : null,
      parameters,
      rules: null,
    })
  }
  return parsed(definitions)
}

export type SignalAction = 'open' | 'close' | 'none'
export type SignalReading = {
  strategy: string
  market: string
  candle: { open: number | null; close: number | null }
  values: { name: string; value: number }[]
  action: SignalAction
  side: 'buy' | 'sell' | null
  /** Percent of the balance an open uses. */
  share: number | null
  signalText: string
  reason: string
  /** "depth=23 deviation=1 …" */
  parameters: string | null
  /** The rules it decided by, in order (a bot without rules: none). */
  rules: string[]
  /** "HH:mm" of the next candle close, UTC. */
  nextClose: string | null
}

const SIDES: Record<string, 'buy' | 'sell'> = { long: 'buy', buy: 'buy', short: 'sell', sell: 'sell' }

/**
 * "open long (50 % of balance)" (the space before % depends on the server's culture), "close long", "none". A bot
 * without rules wrote "open buy (…)" and "close newest position".
 */
export function readSignal(text: string): Pick<SignalReading, 'action' | 'side' | 'share'> {
  const open = /^open (long|short|buy|sell) \((\d+(?:\.\d+)?)\s?% of balance\)$/i.exec(text.trim())
  if (open) return { action: 'open', side: SIDES[open[1]!.toLowerCase()] ?? null, share: Number(open[2]) }
  const close = /^close (long|short)$/i.exec(text.trim())
  if (close) return { action: 'close', side: SIDES[close[1]!.toLowerCase()] ?? null, share: null }
  if (/^close newest position$/i.test(text.trim())) return { action: 'close', side: null, share: null }
  return { action: 'none', side: null, share: null }
}

/** "depth=23 deviation=1 moving-count=2, rules: open long on …; close long on …": the parameters, and the rules. */
export function readStrategyLine(line: string | null): { parameters: string | null; rules: string[] } {
  if (!line) return { parameters: null, rules: [] }
  const at = line.indexOf(', rules: ')
  if (at < 0) return { parameters: line, rules: [] }
  const rules = line.slice(at + ', rules: '.length).split(';').map((rule) => rule.trim()).filter(Boolean)
  return { parameters: line.slice(0, at), rules }
}

const ON_MARKET = /^(\S+) on (\S+ \S+)$/

function readInsight(panel: SectionBlock): Omit<SignalReading, 'parameters' | 'rules' | 'nextClose'> | null {
  const grid = findGrid(panel.blocks)
  const title = ON_MARKET.exec(panel.title)
  if (!grid || !title) return null
  const map = gridMap(grid)
  const candleText = map.get('Candle') ?? ''
  const [openText, closeText] = candleText.split('→').map((part) => part.trim())
  const values = grid.rows
    .filter((row) => !['Candle', 'Signal', 'Why'].includes((row[0] ?? '').trim()))
    .map((row) => ({ name: (row[0] ?? '').trim(), value: parseNumber(row[1]) }))
    .filter((entry): entry is { name: string; value: number } => entry.value != null)
  const signalText = map.get('Signal') ?? 'none'
  return {
    strategy: title[1] ?? '',
    market: title[2] ?? '',
    candle: { open: parseTime(openText ?? null), close: parseTime(closeText ?? null) },
    values,
    ...readSignal(signalText),
    signalText,
    reason: map.get('Why') ?? '',
  }
}

/** `signal` (and the preview panel of `trading start`): the decision on the newest candle and the values behind it. */
export function parseSignal(result: CommandResult): Parsed<SignalReading> {
  const panel = findSection(result.blocks, (title) => ON_MARKET.test(title))
  const insight = panel ? readInsight(panel) : null
  if (!insight) return unreadable('No decision panel in the answer.')
  const tail = topLines(result.blocks).find((line) => /the next candle closes at/.test(line)) ?? null
  const tailMatch = tail ? /^(.*); the next candle closes at (\d{2}:\d{2}) UTC\.?$/.exec(tail) : null
  return parsed({ ...insight, ...readStrategyLine(tailMatch?.[1] ?? null), nextClose: tailMatch?.[2] ?? null })
}

export type BacktestReport = {
  strategy: string
  market: string
  start: number | null
  end: number | null
  candles: number | null
  initialBalance: number
  finalBalance: number
  profitLoss: number
  returnPercent: number | null
  trades: number
  won: number
  lost: number
  winRate: number | null
  average: number | null
  best: number | null
  bestPercent: number | null
  maxDrawdown: number | null
  maxDrawdownPercent: number | null
  stillOpen: number
  computedMs: number | null
  parameters: string | null
  rules: string[]
}

/**
 * `backtest`: a panel "Backtest: drcs on XAUUSD 1h" whose grid has Period, Balance, Profit / loss, Trades,
 * Average per trade, Best trade, Max drawdown, [Still open], Computed in; then the parameters line.
 * Amounts carry no currency (the simulated account has none).
 */
export function parseBacktest(result: CommandResult): Parsed<BacktestReport> {
  const panel = findSection(result.blocks, (title) => title.startsWith('Backtest: '))
  const grid = panel ? findGrid(panel.blocks) : null
  const title = panel ? /^Backtest: (\S+) on (\S+ \S+)$/.exec(panel.title) : null
  if (!panel || !grid || !title) return unreadable('No backtest report in the answer.')
  const map = gridMap(grid)

  const period = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) → (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC, ([\d,]+) candles$/.exec(map.get('Period') ?? '')
  const balance = (map.get('Balance') ?? '').split('→').map((part) => parseMoney(part.trim())?.amount ?? null)
  const profit = /^(\S+)(?:\s+(\S+%))?$/.exec(map.get('Profit / loss') ?? '')
  const trades = /^([\d,]+) closed: ([\d,]+) won, ([\d,]+) lost, win rate ([\d.]+)%$/.exec(map.get('Trades') ?? '')
  const best = /^(\S+)\s+\(([^)]+)\)$/.exec(map.get('Best trade') ?? '')
  const drawdown = /^(\S+)\s+\(([^)]+)\)$/.exec(map.get('Max drawdown') ?? '')
  const open = /^(\d+) position/.exec(map.get('Still open') ?? '')
  const initial = balance[0]
  const final = balance[1]
  if (initial == null || final == null) return unreadable('Unreadable balance line in the backtest report.')
  const strategyLine = topLines(result.blocks).find((line) => /^[\w-]+=\S+( [\w-]+=\S+)*(, rules: .+)?$/.test(line)) ?? null

  return parsed({
    strategy: title[1] ?? '',
    market: title[2] ?? '',
    start: parseTime(period?.[1]),
    end: parseTime(period?.[2]),
    candles: parseNumber(period?.[3]),
    initialBalance: initial,
    finalBalance: final,
    profitLoss: parseMoney(profit?.[1])?.amount ?? final - initial,
    returnPercent: parsePercent(profit?.[2]),
    trades: parseNumber(trades?.[1]) ?? 0,
    won: parseNumber(trades?.[2]) ?? 0,
    lost: parseNumber(trades?.[3]) ?? 0,
    winRate: trades?.[4] ? Number(trades[4]) : null,
    average: parseMoney(map.get('Average per trade'))?.amount ?? null,
    best: parseMoney(best?.[1])?.amount ?? null,
    bestPercent: parsePercent(best?.[2]),
    maxDrawdown: parseMoney(drawdown?.[1])?.amount ?? null,
    maxDrawdownPercent: parsePercent(drawdown?.[2]),
    stillOpen: open ? Number(open[1]) : 0,
    computedMs: parseElapsed(map.get('Computed in')),
    ...readStrategyLine(strategyLine),
  })
}

/** Parameters echoed as "depth=23 deviation=1 moving-count=2" (the part before ", rules:"). */
export function readParameterLine(line: string | null): Record<string, number> {
  const values: Record<string, number> = {}
  for (const part of (line ?? '').split(/\s+/)) {
    const [name, value] = part.split('=')
    const number = parseNumber(value)
    if (name && number != null) values[name] = number
  }
  return values
}
