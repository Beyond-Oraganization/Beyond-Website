import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react'
import { Button, IconButton, cx } from './ui.tsx'

/**
 * A modal sheet on the native <dialog>: the browser keeps focus inside it and Escape closes it. On a phone it
 * rises from the bottom; elsewhere it is the website's bordered box with a hard shadow.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  bare,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Children render their own .sheet-body and .sheet-foot. */
  bare?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closed = useEffectEvent(() => onClose())

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // The browser fires `close` later, as a task: by then the sheet may be open again, and that event is stale.
    const listener = () => {
      if (!dialog.open) closed()
    }
    dialog.addEventListener('close', listener)
    return () => dialog.removeEventListener('close', listener)
  }, [])

  return (
    // The dialog closes on Escape natively; a click on the backdrop (the dialog itself) closes it too.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={cx('sheet', wide && 'wide')}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      {open ? (
        <>
          <div className="sheet-head">
            <h2 className="h3" id={titleId}>
              {title}
            </h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
          {bare ? children : <div className="sheet-body">{children}</div>}
          {footer ? <div className="sheet-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  )
}

export type ReviewRow = [label: string, value: ReactNode]

/**
 * Asks before anything that changes the bot or the broker. It names exactly what will happen; `typed` asks
 * for a word to be typed first (for deleting records). A failure stays in the sheet, with the bot's hint.
 */
type ConfirmProps = {
  open: boolean
  onClose: () => void
  title: string
  intro?: ReactNode
  review?: ReviewRow[]
  confirmLabel: string
  danger?: boolean
  typed?: string
  onConfirm: () => Promise<void>
  children?: ReactNode
}

/**
 * Asks before anything that changes the bot or the broker. It names exactly what will happen; `typed` asks
 * for a word to be typed first (for deleting records). A failure stays in the sheet, with the bot's hint.
 */
export function ConfirmSheet(props: ConfirmProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={props.open} onClose={busy ? () => {} : props.onClose} title={props.title} bare>
      {props.open ? <ConfirmBody {...props} busy={busy} setBusy={setBusy} /> : null}
    </Sheet>
  )
}

function ConfirmBody({ onClose, intro, review, confirmLabel, danger, typed, onConfirm, children, busy, setBusy }: ConfirmProps & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const [error, setError] = useState<{ message: string; hint?: string | null } | null>(null)
  const [text, setText] = useState('')
  const typedId = useId()

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      setBusy(false)
      onClose()
    } catch (failure) {
      const value = failure as { message?: string; hint?: string | null }
      setError({ message: value.message ?? String(failure), hint: value.hint ?? null })
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sheet-body">
        {intro ? <div className="p">{intro}</div> : null}
        {review?.length ? (
          <dl className="review">
            {review.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
        {typed ? (
          <div className="field">
            <label htmlFor={typedId}>Type {typed} to confirm</label>
            <input id={typedId} className="mono" autoComplete="off" spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} />
          </div>
        ) : null}
        {error ? (
          <div className="callout error" role="alert">
            <span className="label">The bot said no</span>
            <p className="p">{error.message}</p>
            {error.hint ? <p className="hint">{error.hint}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="sheet-foot">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'solid'} busy={busy} disabled={typed ? text !== typed : false} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </>
  )
}
