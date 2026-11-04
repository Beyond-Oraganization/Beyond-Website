import { useEffect, useId, useMemo } from 'react'
import type { StrategyInput } from '../api/commands.ts'
import type { MarketRow } from '../api/parse/markets.ts'
import type { StrategyDefinition, StrategyParameter } from '../api/parse/strategies.ts'
import { describedBy, Field } from './Field.tsx'

export type StrategyDraft = { strategy: string; market: string; params: Record<string, string> }

/** Checks a draft against the catalog: ranges, whole numbers, and Double Red Cross's trigger ≤ moving-count. */
export function validateDraft(draft: StrategyDraft, definition: StrategyDefinition | undefined): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!definition) return { strategy: 'Choose a strategy.' }
  if (!draft.market) errors.market = 'Choose a stored market.'
  for (const parameter of definition.parameters) {
    const text = draft.params[parameter.name] ?? ''
    const value = Number(text)
    if (text.trim() === '' || Number.isNaN(value)) errors[parameter.name] = `${parameter.name} must be a number.`
    else if (value < parameter.min || value > parameter.max) errors[parameter.name] = `${parameter.name} must be between ${parameter.min} and ${parameter.max}.`
    else if (parameter.whole && !Number.isInteger(value)) errors[parameter.name] = `${parameter.name} must be a whole number.`
  }
  const trigger = Number(draft.params.trigger)
  const count = Number(draft.params['moving-count'])
  if (!errors.trigger && !errors['moving-count'] && 'trigger' in draft.params && 'moving-count' in draft.params && trigger > count)
    errors.trigger = 'The trigger band cannot be beyond the last band (moving-count).'
  return errors
}

export function toInput(draft: StrategyDraft): StrategyInput {
  const [symbol = '', interval = ''] = draft.market.split(' ')
  return { strategy: draft.strategy, symbol, interval, params: Object.fromEntries(Object.entries(draft.params).map(([name, text]) => [name, Number(text)])) }
}

export const defaultsOf = (definition: StrategyDefinition) => Object.fromEntries(definition.parameters.map((p) => [p.name, String(p.default)]))

export function initialDraft(definitions: StrategyDefinition[], markets: MarketRow[], preferred?: { symbol?: string | null; interval?: string | null }): StrategyDraft | null {
  const definition = definitions[0]
  if (!definition) return null
  const stored = markets.filter((m) => m.interval).map((m) => `${m.symbol} ${m.interval}`)
  const wanted = preferred?.symbol && preferred.interval ? `${preferred.symbol} ${preferred.interval}` : null
  const fallback = definition.defaultMarket ? `${definition.defaultMarket.symbol} ${definition.defaultMarket.interval}` : null
  const market = (wanted && stored.includes(wanted) && wanted) || (fallback && stored.includes(fallback) && fallback) || stored[0] || ''
  return { strategy: definition.name, market, params: defaultsOf(definition) }
}

function ParameterField({ parameter, value, error, onChange }: { parameter: StrategyParameter; value: string; error?: string; onChange: (value: string) => void }) {
  const id = useId()
  const hint = `${parameter.meaning}. ${parameter.min}–${parameter.max}, default ${parameter.default}.`
  return (
    <Field id={id} label={parameter.name} hint={hint} error={error}>
      <input
        id={id}
        className="mono"
        type="number"
        inputMode={parameter.whole ? 'numeric' : 'decimal'}
        min={parameter.min}
        max={parameter.max}
        step={parameter.whole ? 1 : 'any'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
    </Field>
  )
}

/**
 * The strategy, the market and every parameter, built from the bot's catalog (as the TUI's StrategyForm is):
 * defaults filled in, ranges shown and checked. The bot checks again and its message is shown if it disagrees.
 */
export function StrategyForm({
  definitions,
  markets,
  draft,
  onChange,
  errors,
}: {
  definitions: StrategyDefinition[]
  markets: MarketRow[]
  draft: StrategyDraft
  onChange: (draft: StrategyDraft) => void
  errors: Record<string, string>
}) {
  const strategyId = useId()
  const marketId = useId()
  const definition = definitions.find((d) => d.name === draft.strategy)
  const stored = useMemo(() => markets.filter((m) => m.interval).map((m) => `${m.symbol} ${m.interval}`), [markets])

  useEffect(() => {
    if (definition && Object.keys(draft.params).length === 0) onChange({ ...draft, params: defaultsOf(definition) })
  }, [definition, draft, onChange])

  return (
    <div className="stack">
      <div className="form-grid">
        <Field id={strategyId} label="Strategy" error={errors.strategy} hint={definition?.title}>
          <select id={strategyId} value={draft.strategy} onChange={(event) => {
            const next = definitions.find((d) => d.name === event.target.value)
            onChange({ ...draft, strategy: event.target.value, params: next ? defaultsOf(next) : {} })
          }}>
            {definitions.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} – {d.title}
              </option>
            ))}
          </select>
        </Field>
        <Field id={marketId} label="Market" error={errors.market} hint={stored.length ? 'Markets stored on the bot.' : 'No market is stored yet: add one on Markets.'}>
          <select id={marketId} value={draft.market} onChange={(event) => onChange({ ...draft, market: event.target.value })} aria-invalid={errors.market ? true : undefined}>
            {stored.length ? null : <option value="">No stored market</option>}
            {stored.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {definition ? (
        <div className="form-grid">
          {definition.parameters.map((parameter) => (
            <ParameterField
              key={parameter.name}
              parameter={parameter}
              value={draft.params[parameter.name] ?? ''}
              error={errors[parameter.name]}
              onChange={(value) => onChange({ ...draft, params: { ...draft.params, [parameter.name]: value } })}
            />
          ))}
        </div>
      ) : null}
      {definition ? (
        <div>
          <button type="button" className="link small" onClick={() => onChange({ ...draft, params: defaultsOf(definition) })}>
            Reset the parameters to their defaults
          </button>
        </div>
      ) : null}
    </div>
  )
}
