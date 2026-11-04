import { useId, useState } from 'react'
import { readRule, ruleTemplate, slotLabel, writeRule, type RuleGrammar } from '../strategy/rules.ts'
import { IconButton } from './ui.tsx'

/** One rule as controls, one per position of the strategy's syntax: words as text, choices as menus, numbers as fields. */
function RuleParts({ grammar, values, label, invalid, onChange }: { grammar: RuleGrammar; values: string[]; label: string; invalid: boolean; onChange: (values: string[]) => void }) {
  const set = (index: number, value: string) => onChange(values.map((current, i) => (i === index ? value : current)))
  return (
    <div className="rule-parts" role="group" aria-label={label}>
      {grammar.slots.map((slot, index) => {
        const name = `${label}: ${slotLabel(grammar, index)}`
        if (slot.kind === 'word')
          return (
            <span key={index} className="rule-word">
              {slot.text}
            </span>
          )
        if (slot.kind === 'choice')
          return (
            <select key={index} aria-label={name} aria-invalid={invalid || undefined} value={values[index]} onChange={(event) => set(index, event.target.value)}>
              {slot.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )
        return (
          <input
            key={index}
            aria-label={name}
            aria-invalid={invalid || undefined}
            className="mono rule-number"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={values[index]}
            onChange={(event) => set(index, event.target.value)}
          />
        )
      })}
    </div>
  )
}

type Row = { text: boolean; parts: string[] | null }

/**
 * The rules of a strategy, in the order the bot tries them (the first that fires gives the signal). Each rule is
 * built from controls when the strategy's syntax allows it, and can always be written as text instead: that is
 * also how a strategy whose syntax the app cannot build is edited. The bot checks every rule again.
 */
export function RuleEditor({
  rules,
  grammar,
  syntax,
  defaults,
  errors,
  listError,
  onChange,
}: {
  rules: string[]
  grammar: RuleGrammar | null
  syntax: string
  defaults: string[]
  errors: Record<number, string | undefined>
  listError?: string
  onChange: (rules: string[]) => void
}) {
  const id = useId()
  // Per row, aligned with the rules (moved and removed with them): written as text, and the values being chosen.
  // The values are kept while a number is half typed (empty), so the row does not turn into text under the cursor;
  // they count only while they still write the rule's text, so a reset or a loaded setup replaces them.
  const [rows, setRows] = useState<Row[]>([])
  const rowAt = (index: number): Row => rows[index] ?? { text: !grammar, parts: null }
  const textAt = (index: number) => !grammar || rowAt(index).text
  const partsAt = (index: number) => {
    const kept = rowAt(index).parts
    if (grammar && kept && writeRule(grammar, kept) === rules[index]) return kept
    return grammar ? readRule(grammar, rules[index] ?? '') : null
  }
  const current = () => rules.map((_, i) => rowAt(i))

  const update = (next: string[], nextRows: Row[]) => {
    setRows(nextRows)
    onChange(next)
  }
  const move = (from: number, to: number) => {
    const next = [...rules]
    const nextRows = current()
    ;[next[from], next[to]] = [next[to]!, next[from]!]
    ;[nextRows[from], nextRows[to]] = [nextRows[to]!, nextRows[from]!]
    update(next, nextRows)
  }
  const remove = (index: number) =>
    update(
      rules.filter((_, i) => i !== index),
      current().filter((_, i) => i !== index),
    )
  const add = () => update([...rules, grammar ? ruleTemplate(grammar, defaults) : ''], [...current(), { text: !grammar, parts: null }])
  const setText = (index: number, text: string) => onChange(rules.map((rule, i) => (i === index ? text : rule)))
  const setParts = (index: number, parts: string[]) => {
    setRows(current().map((row, i) => (i === index ? { ...row, parts } : row)))
    onChange(rules.map((rule, i) => (i === index && grammar ? writeRule(grammar, parts) : rule)))
  }
  const setMode = (index: number, text: boolean) => setRows(current().map((row, i) => (i === index ? { text, parts: null } : row)))

  return (
    <fieldset className="field rules-field" aria-describedby={`${id}-hint`}>
      <legend>Rules</legend>
      <p className="hint" id={`${id}-hint`}>
        Tried in order on each closed candle: the first that fires gives the signal. Written <code className="mono">{syntax}</code>.
      </p>
      {listError ? <p className="field-error">{listError}</p> : null}
      <ol className="rules">
        {rules.map((rule, index) => {
          const label = `Rule ${index + 1}`
          const values = partsAt(index)
          const error = errors[index]
          const errorId = `${id}-${index}-error`
          return (
            <li key={index} className="rule">
              <span className="rule-n" aria-hidden="true">
                {index + 1}
              </span>
              <div className="stack-sm">
                {!textAt(index) && grammar && values ? (
                  <RuleParts grammar={grammar} values={values} label={label} invalid={Boolean(error)} onChange={(next) => setParts(index, next)} />
                ) : (
                  <input
                    className="mono rule-text"
                    aria-label={label}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={defaults[0] ?? syntax}
                    value={rule}
                    onChange={(event) => setText(index, event.target.value)}
                  />
                )}
                {error ? (
                  <p className="field-error" id={errorId}>
                    {error}
                  </p>
                ) : null}
                {grammar ? (
                  textAt(index) ? (
                    <button type="button" className="link small" disabled={!(grammar && readRule(grammar, rule))} onClick={() => setMode(index, false)}>
                      {readRule(grammar, rule) ? 'Choose from the lists' : 'Fix the text to choose it from the lists'}
                    </button>
                  ) : (
                    <button type="button" className="link small" onClick={() => setMode(index, true)}>
                      Write it as text
                    </button>
                  )
                ) : null}
              </div>
              <div className="rule-tools">
                <IconButton icon="up" label={`Move ${label.toLowerCase()} up`} disabled={index === 0} onClick={() => move(index, index - 1)} />
                <IconButton icon="down" label={`Move ${label.toLowerCase()} down`} disabled={index === rules.length - 1} onClick={() => move(index, index + 1)} />
                <IconButton icon="trash" label={`Remove ${label.toLowerCase()}`} onClick={() => remove(index)} />
              </div>
            </li>
          )
        })}
      </ol>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost btn-compact" onClick={add}>
          Add a rule
        </button>
        {defaults.length ? (
          <button type="button" className="link small" onClick={() => update([...defaults], defaults.map(() => ({ text: !grammar, parts: null })))}>
            Reset the rules to the defaults
          </button>
        ) : null}
      </div>
    </fieldset>
  )
}
