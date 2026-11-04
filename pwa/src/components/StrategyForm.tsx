import { useId, useMemo, useState } from 'react'
import { useBot } from '../api/bot.ts'
import type { MarketRow } from '../api/parse/markets.ts'
import type { StrategyDefinition, StrategyParameter } from '../api/parse/strategies.ts'
import { applySetup, defaultParams, grammarOf, paramKey, ruleKey, storedMarkets, usesDefaultRules, withStrategy, type ConfigErrors, type StrategyConfig } from '../strategy/config.ts'
import { MAX_SETUP_NAME, findSetup, useSetups } from '../strategy/setups.ts'
import { describedBy, Field } from './Field.tsx'
import { RuleEditor } from './RuleEditor.tsx'
import { toast } from './Toasts.tsx'
import { Button, Pill } from './ui.tsx'

function ParameterField({ parameter, value, error, onChange }: { parameter: StrategyParameter; value: string; error?: string; onChange: (value: string) => void }) {
  const id = useId()
  const hint = `${parameter.meaning ? `${parameter.meaning}. ` : ''}${parameter.min}–${parameter.max}, default ${parameter.default}.`
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

/** Named setups (strategy, parameters, rules) kept on this device for this bot, to apply to any market. */
function Setups({ definitions, config, onApply }: { definitions: StrategyDefinition[]; config: StrategyConfig; onApply: (config: StrategyConfig) => void }) {
  const { connection } = useBot()
  const { setups, save, remove } = useSetups(connection?.id)
  const chooseId = useId()
  const nameId = useId()
  const [chosen, setChosen] = useState('')
  const [name, setName] = useState('')
  const selected = findSetup(setups, chosen)

  const apply = () => {
    if (!selected) return
    const definition = definitions.find((d) => d.name === selected.strategy)
    if (!definition) return toast.error('Not on this bot', `${selected.name} uses ${selected.strategy}, which this bot does not have.`)
    const { config: next, dropped } = applySetup(config, selected, definition)
    onApply(next)
    toast.info(`Applied ${selected.name}`, dropped.length ? `${dropped.join(', ')} no longer exist${dropped.length === 1 ? 's' : ''} and ${dropped.length === 1 ? 'was' : 'were'} left out.` : undefined)
  }
  const store = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const replacing = Boolean(findSetup(setups, trimmed))
    save({ name: trimmed, strategy: config.strategy, params: { ...config.params }, rules: [...config.rules], savedAt: Date.now() })
    setChosen(trimmed)
    setName('')
    toast.success(replacing ? 'Setup replaced' : 'Setup saved', `${trimmed}: ${config.strategy}, ${config.rules.length} rule${config.rules.length === 1 ? '' : 's'}.`)
  }

  return (
    <details className="more-box">
      <summary>Saved setups{setups.length ? ` (${setups.length})` : ''}</summary>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <Field id={chooseId} label="Setup" hint={setups.length ? 'Kept on this device for this bot. Applying keeps the market.' : 'None saved yet: save the one below.'}>
          <select id={chooseId} value={chosen} onChange={(event) => setChosen(event.target.value)} disabled={!setups.length}>
            <option value="">Choose a setup</option>
            {setups.map((setup) => (
              <option key={setup.name} value={setup.name}>
                {setup.name} ({setup.strategy})
              </option>
            ))}
          </select>
        </Field>
        <Field id={nameId} label="Save this setup as" hint="A setup of the same name is replaced.">
          <input id={nameId} value={name} maxLength={MAX_SETUP_NAME} autoComplete="off" placeholder="e.g. Short the upper band" onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <Button compact variant="ghost" disabled={!selected} onClick={apply}>
          Apply
        </Button>
        <Button compact variant="ghost" disabled={!name.trim()} onClick={store}>
          Save
        </Button>
        <Button
          compact
          variant="ghost"
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            remove(selected.name)
            setChosen('')
            toast.info('Setup removed', selected.name)
          }}
        >
          Remove
        </Button>
      </div>
    </details>
  )
}

/**
 * The strategy, the market, its parameters and its rules, all built from the bot's catalog: nothing here knows a
 * strategy, so a new one on the bot needs no change in the app. Defaults are filled in and ranges and rule syntax
 * checked as you type; the bot checks again, and its message is shown if it disagrees.
 */
export function StrategyForm({
  definitions,
  markets,
  config,
  onChange,
  errors,
}: {
  definitions: StrategyDefinition[]
  markets: MarketRow[]
  config: StrategyConfig
  onChange: (config: StrategyConfig) => void
  errors: ConfigErrors
}) {
  const strategyId = useId()
  const marketId = useId()
  const definition = definitions.find((d) => d.name === config.strategy)
  const stored = useMemo(() => storedMarkets(markets), [markets])
  const grammar = grammarOf(definition)
  const ruleErrors = useMemo(() => Object.fromEntries(config.rules.map((_, index) => [index, errors[ruleKey(index)]])), [config.rules, errors])

  return (
    <div className="stack">
      <div className="form-grid">
        <Field id={strategyId} label="Strategy" error={errors.strategy} hint={definition?.title}>
          <select
            id={strategyId}
            value={config.strategy}
            onChange={(event) => {
              const next = definitions.find((d) => d.name === event.target.value)
              if (next) onChange(withStrategy(config, next))
            }}
          >
            {definitions.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} – {d.title}
              </option>
            ))}
          </select>
        </Field>
        <Field id={marketId} label="Market" error={errors.market} hint={stored.length ? 'Markets stored on the bot.' : 'No market is stored yet: add one on Markets.'}>
          <select id={marketId} value={config.market} onChange={(event) => onChange({ ...config, market: event.target.value })} aria-invalid={errors.market ? true : undefined}>
            {stored.length ? null : <option value="">No stored market</option>}
            {stored.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {definition?.parameters.length ? (
        <>
          <div className="form-grid">
            {definition.parameters.map((parameter) => (
              <ParameterField
                key={parameter.name}
                parameter={parameter}
                value={config.params[parameter.name] ?? ''}
                error={errors[paramKey(parameter.name)]}
                onChange={(value) => onChange({ ...config, params: { ...config.params, [parameter.name]: value } })}
              />
            ))}
          </div>
          <div>
            <button type="button" className="link small" onClick={() => onChange({ ...config, params: defaultParams(definition) })}>
              Reset the parameters to their defaults
            </button>
          </div>
        </>
      ) : null}
      {definition?.rules ? (
        <>
          <div className="pills">{usesDefaultRules(config, definition) ? <Pill>Default rules</Pill> : <Pill tone="accent">Your rules</Pill>}</div>
          <RuleEditor
            rules={config.rules}
            grammar={grammar}
            syntax={definition.rules.syntax}
            defaults={definition.rules.defaults}
            errors={ruleErrors}
            listError={errors.rules}
            onChange={(rules) => onChange({ ...config, rules })}
          />
        </>
      ) : null}
      <Setups definitions={definitions} config={config} onApply={onChange} />
    </div>
  )
}
