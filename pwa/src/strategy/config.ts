import { plainNumber, type StrategyInput } from '../api/commands.ts'
import type { MarketRow } from '../api/parse/markets.ts'
import type { SizingCatalog, StrategyDefinition } from '../api/parse/strategies.ts'
import { compileRuleSyntax, readRule, type RuleGrammar } from './rules.ts'

/** How big each position is: a sizing method of the bot's catalog (`percent`, `fixed`, `kelly`) and its value, as typed. */
export type SizingConfig = { method: string; value: string }

/**
 * How a strategy trades: which one, on which market, its parameters (as typed), its rules, in the order they are
 * tried, and how its positions are sized (null on a bot from before sizing). It is the same shape for every
 * strategy; what a strategy accepts comes from the bot's catalog, so a new strategy needs no change here.
 */
export type StrategyConfig = { strategy: string; market: string; params: Record<string, string>; rules: string[]; sizing: SizingConfig | null }

/** What is wrong with a config, by place: `strategy`, `market`, `param:<name>`, `rules`, `rule:<index>`, `sizing`. */
export type ConfigErrors = Record<string, string>
export const paramKey = (name: string) => `param:${name}`
export const ruleKey = (index: number) => `rule:${index}`
export const SIZING_KEY = 'sizing'

/** Separates rules in one value on the bot's side (TradingRule.Separator), so one rule cannot hold it. */
const RULE_SEPARATOR = ';'

const grammars = new Map<string, RuleGrammar | null>()

/** The rule grammar of a strategy, or null when it has no rules or its syntax cannot be built (then rules are text). */
export function grammarOf(definition: StrategyDefinition | undefined): RuleGrammar | null {
  const syntax = definition?.rules?.syntax
  if (!syntax) return null
  if (!grammars.has(syntax)) grammars.set(syntax, compileRuleSyntax(syntax))
  return grammars.get(syntax) ?? null
}

export const defaultParams = (definition: StrategyDefinition) => Object.fromEntries(definition.parameters.map((p) => [p.name, String(p.default)]))
export const defaultRules = (definition: StrategyDefinition) => [...(definition.rules?.defaults ?? [])]

/** `percent:25` as a config; null for text that is not METHOD or METHOD:VALUE. */
export function readSizing(text: string | null | undefined): SizingConfig | null {
  const match = /^([a-z]+)(?::(.+))?$/i.exec((text ?? '').trim())
  return match ? { method: match[1]!.toLowerCase(), value: match[2] ?? '' } : null
}

/** The sizing the bot uses when none is sent, with the value written out (`kelly` alone is its default share). */
export function defaultSizing(catalog: SizingCatalog | null): SizingConfig | null {
  const read = readSizing(catalog?.default)
  if (!catalog || !read) return null
  const method = catalog.methods.find((m) => m.name === read.method)
  return { method: read.method, value: read.value || String(method?.value.default ?? '') }
}

/** The sizing of a method chosen in the form: its default value. */
export function sizingFor(catalog: SizingCatalog, name: string): SizingConfig {
  const method = catalog.methods.find((m) => m.name === name)
  return { method: name, value: method ? String(method.value.default) : '' }
}

export const storedMarkets = (markets: MarketRow[]) => markets.filter((m) => m.interval).map((m) => `${m.symbol} ${m.interval}`)

/** The market to start from: the one asked for, else the strategy's own, else the first stored one. */
function marketFor(definition: StrategyDefinition, markets: MarketRow[], preferred?: { symbol?: string | null; interval?: string | null }): string {
  const stored = storedMarkets(markets)
  const wanted = preferred?.symbol && preferred.interval ? `${preferred.symbol} ${preferred.interval}` : null
  const own = definition.defaultMarket ? `${definition.defaultMarket.symbol} ${definition.defaultMarket.interval}` : null
  return (wanted && stored.includes(wanted) && wanted) || (own && stored.includes(own) && own) || stored[0] || ''
}

export function initialConfig(definitions: StrategyDefinition[], markets: MarketRow[], preferred?: { symbol?: string | null; interval?: string | null; strategy?: string | null }): StrategyConfig | null {
  const definition = definitions.find((d) => d.name === preferred?.strategy) ?? definitions[0]
  if (!definition) return null
  return { strategy: definition.name, market: marketFor(definition, markets, preferred), params: defaultParams(definition), rules: defaultRules(definition), sizing: defaultSizing(definition.sizing) }
}

/** Another strategy: its defaults, on the same market, sized as before (sizing is the session's, not the strategy's). */
export const withStrategy = (config: StrategyConfig, definition: StrategyDefinition): StrategyConfig => ({
  ...config,
  strategy: definition.name,
  params: defaultParams(definition),
  rules: defaultRules(definition),
  sizing: definition.sizing ? (config.sizing ?? defaultSizing(definition.sizing)) : null,
})

/**
 * A saved setup applied to the strategy as the bot describes it now: parameters it no longer has are dropped (and
 * named), new ones take their defaults, rules are kept only by a strategy that has rules, and the setup's sizing is
 * used by a bot that sizes (a setup saved before sizing keeps the current one).
 */
export function applySetup(
  config: StrategyConfig,
  setup: Pick<StrategyConfig, 'strategy' | 'params' | 'rules'> & { sizing?: SizingConfig | null },
  definition: StrategyDefinition,
): { config: StrategyConfig; dropped: string[] } {
  const known = new Set(definition.parameters.map((p) => p.name))
  const dropped = Object.keys(setup.params).filter((name) => !known.has(name))
  const params = { ...defaultParams(definition), ...Object.fromEntries(Object.entries(setup.params).filter(([name]) => known.has(name))) }
  const rules = definition.rules ? (setup.rules.length ? [...setup.rules] : defaultRules(definition)) : []
  const sizing = definition.sizing ? (setup.sizing ?? config.sizing ?? defaultSizing(definition.sizing)) : null
  return { config: { ...config, strategy: definition.name, params, rules, sizing }, dropped }
}

export const usesDefaultRules = (config: StrategyConfig, definition: StrategyDefinition) =>
  config.rules.length === definition.rules?.defaults.length && config.rules.every((rule, index) => rule.trim() === definition.rules?.defaults[index])

/**
 * Checks what the catalog says: every parameter a number in its range (a whole number where it must be), and every
 * rule written as the strategy's syntax says. What depends on several values (such as a band beyond moving-count)
 * is the bot's to judge: it answers with a message, shown next to the form.
 */
export function validateConfig(config: StrategyConfig, definition: StrategyDefinition | undefined): ConfigErrors {
  if (!definition) return { strategy: 'Choose a strategy.' }
  const errors: ConfigErrors = {}
  if (!config.market) errors.market = 'Choose a stored market.'
  for (const parameter of definition.parameters) {
    const text = (config.params[parameter.name] ?? '').trim()
    const value = Number(text)
    if (text === '' || Number.isNaN(value)) errors[paramKey(parameter.name)] = `${parameter.name} must be a number.`
    else if (value < parameter.min || value > parameter.max) errors[paramKey(parameter.name)] = `${parameter.name} must be between ${parameter.min} and ${parameter.max}.`
    else if (parameter.whole && !Number.isInteger(value)) errors[paramKey(parameter.name)] = `${parameter.name} must be a whole number.`
  }
  const sizingError = validateSizing(config.sizing, definition.sizing)
  if (sizingError) errors[SIZING_KEY] = sizingError
  if (!definition.rules) return errors
  if (!config.rules.length) errors.rules = 'Add at least one rule, or reset them to the defaults.'
  const grammar = grammarOf(definition)
  config.rules.forEach((rule, index) => {
    if (!rule.trim()) errors[ruleKey(index)] = 'Write the rule, or remove it.'
    else if (rule.includes(RULE_SEPARATOR)) errors[ruleKey(index)] = 'One rule per line: put the next rule on its own line.'
    else if (grammar && !readRule(grammar, rule)) errors[ruleKey(index)] = `Write it as: ${definition.rules!.syntax}.`
  })
  return errors
}

/** The sizing's value checked against its method's range in the catalog; nothing to check on a bot without sizing. */
function validateSizing(sizing: SizingConfig | null, catalog: SizingCatalog | null): string | null {
  if (!catalog) return null
  const method = catalog.methods.find((m) => m.name === sizing?.method)
  if (!sizing || !method) return 'Choose a position sizing.'
  const text = sizing.value.trim()
  const value = Number(text)
  if (text === '' || Number.isNaN(value)) return `${method.value.name} must be a number.`
  if (value < method.value.min || value > method.value.max) return `${method.value.name} must be between ${method.value.min} and ${method.value.max}.`
  return null
}

/**
 * What the commands send. Rules go only to a strategy that has them, and always in full, so a run says exactly what it
 * did; the sizing likewise, as `METHOD:VALUE`, only to a bot that sizes.
 */
export function toInput(config: StrategyConfig, definition: StrategyDefinition | undefined): StrategyInput {
  const [symbol = '', interval = ''] = config.market.split(' ')
  return {
    strategy: config.strategy,
    symbol,
    interval,
    params: Object.fromEntries(Object.entries(config.params).map(([name, text]) => [name, Number(text)])),
    rules: definition?.rules ? config.rules.map((rule) => rule.trim().replace(/\s+/g, ' ')) : [],
    ...(definition?.sizing && config.sizing ? { sizing: `${config.sizing.method}:${plainNumber(Number(config.sizing.value))}` } : {}),
  }
}

/** A run's input back as a config, to run again or change (a run saved before rules or sizing has none: the defaults apply). */
export const configFromInput = (input: StrategyInput): StrategyConfig => ({
  strategy: input.strategy,
  market: `${input.symbol} ${input.interval}`,
  params: Object.fromEntries(Object.entries(input.params).map(([name, value]) => [name, String(value)])),
  rules: [...(input.rules ?? [])],
  sizing: readSizing(input.sizing),
})

/**
 * A sizing as sent (`kelly:50`) in words, for confirmations: "50% of the balance per position", "Kelly: 50% of the Kelly
 * percent of the balance, …". A method the app does not know is shown by its catalog title.
 */
export function describeSizing(sizing: string | undefined, catalog: SizingCatalog | null): string {
  if (!catalog || !sizing) return '50% of the balance per position (this bot cannot size otherwise)'
  const read = readSizing(sizing)
  const value = read?.value ?? ''
  switch (read?.method) {
    case 'percent':
      return `${value}% of the balance per position`
    case 'fixed':
      return `${value} of the account’s currency per position`
    case 'kelly':
      return `Kelly: ${Number(value) >= 100 ? 'the full Kelly percent' : `${value}% of the Kelly percent`} of the balance, from a backtest of this setup`
    default:
      return `${catalog.methods.find((m) => m.name === read?.method)?.title ?? read?.method ?? sizing}: ${value}`
  }
}

/** "depth=23 deviation=1 moving-count=2", for confirmations. */
export const describeParams = (input: StrategyInput) => Object.entries(input.params).map(([name, value]) => `${name}=${value}`).join(' ')
