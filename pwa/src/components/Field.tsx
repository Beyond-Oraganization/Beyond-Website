import type { ReactNode } from 'react'
import { cx } from './ui.tsx'

/** aria-describedby for an input with an optional hint and error, in the website's order (error first). */
export const describedBy = (id: string, hint?: ReactNode, error?: ReactNode) =>
  [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined

/**
 * The website's form field: an uppercase mono label, a 3px bordered input with a hard shadow, the error (a red
 * square and bold text) under it, then the hint.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('field', className)}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** A row of connected choice buttons (radio inputs), e.g. Buy / Sell or the candle intervals. */
export function Segmented<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  hint,
  disabled,
}: {
  name: string
  legend: ReactNode
  options: { value: T; label: ReactNode; disabled?: boolean }[]
  value: T | null
  onChange: (value: T) => void
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <fieldset className="field" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="seg">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
    </fieldset>
  )
}

/** A text input in a Field, wired to react-hook-form's register() result and error. */
export function TextField({
  id,
  label,
  hint,
  error,
  registration,
  type = 'text',
  mono,
  autoComplete = 'off',
  inputMode,
  placeholder,
  spellCheck = false,
  className,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string
  registration: Record<string, unknown>
  type?: string
  mono?: boolean
  autoComplete?: string
  inputMode?: 'text' | 'decimal' | 'numeric' | 'url' | 'email'
  placeholder?: string
  spellCheck?: boolean
  className?: string
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <input
        id={id}
        type={type}
        className={cx(mono && 'mono')}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        spellCheck={spellCheck}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...registration}
      />
    </Field>
  )
}
