import { create } from 'zustand'
import { db } from './db.ts'

export type Settings = {
  /** How often the session is read while the app is visible. */
  refreshSeconds: number
  /** System notifications for trades and errors while the app runs (toasts are always on). */
  notifications: boolean
  /** Passphrase keys are forgotten after the app has been in the background this long. */
  autoLockMinutes: number
  /** Which closed-by-default panels were left open (the Backtest page's figure tables), by name. */
  openPanels: Record<string, boolean>
  /** Candles shown on a market's chart. */
  candles: number
}

export const DEFAULT_SETTINGS: Settings = { refreshSeconds: 5, notifications: false, autoLockMinutes: 15, openPanels: {}, candles: 200 }

export const useSettings = create<Settings & { load: () => Promise<void>; change: (patch: Partial<Settings>) => Promise<void> }>((set, get) => ({
  ...DEFAULT_SETTINGS,
  async load() {
    set({ ...DEFAULT_SETTINGS, ...((await db.get<Partial<Settings>>('settings')) ?? {}) })
  },
  async change(patch) {
    set(patch)
    const { refreshSeconds, notifications, autoLockMinutes, openPanels, candles } = get()
    await db.set('settings', { refreshSeconds, notifications, autoLockMinutes, openPanels, candles })
  },
}))
