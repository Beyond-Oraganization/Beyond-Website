import { create } from 'zustand'
import { cx } from './ui.tsx'

export type ToastTone = 'info' | 'success' | 'error'
export type Toast = {
  id: number
  tone: ToastTone
  title: string
  text?: string
  action?: { label: string; run: () => void }
  /** Milliseconds; 0 keeps it until closed. */
  timeout: number
}

type ToastState = {
  toasts: Toast[]
  show: (toast: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }) => number
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: (toast) => {
    const id = nextId++
    const timeout = toast.timeout ?? (toast.tone === 'error' ? 0 : 6000)
    set({ toasts: [...get().toasts.slice(-3), { ...toast, id, timeout }] })
    if (timeout > 0) setTimeout(() => get().dismiss(id), timeout)
    return id
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}))

export const toast = {
  info: (title: string, text?: string) => useToasts.getState().show({ tone: 'info', title, text }),
  success: (title: string, text?: string) => useToasts.getState().show({ tone: 'success', title, text }),
  error: (title: string, text?: string) => useToasts.getState().show({ tone: 'error', title, text }),
  show: (value: Parameters<ToastState['show']>[0]) => useToasts.getState().show(value),
}

const LABEL: Record<ToastTone, string> = { info: 'Note', success: 'Done', error: 'Failed' }

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((item) => (
        <div key={item.id} className={cx('toast', item.tone)} role={item.tone === 'error' ? 'alert' : 'status'}>
          <span className="mark" aria-hidden="true" />
          <p className="toast-title">
            <span className="vh">{LABEL[item.tone]}: </span>
            {item.title}
          </p>
          <button type="button" className="x" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
            ×
          </button>
          {item.text ? <p className="toast-text">{item.text}</p> : null}
          {item.action ? (
            <div className="toast-actions">
              <button
                type="button"
                className="link"
                onClick={() => {
                  item.action?.run()
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
