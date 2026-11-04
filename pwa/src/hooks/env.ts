import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
/** True while the page can be seen; polls pause when it cannot. */
export const useVisible = () => useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true)

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

/** The current time, updated every `ms` (for countdowns and "3 s ago"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

type WakeLockSentinelLike = { release: () => Promise<void> }

/**
 * Keeps the screen on while `active` (a long download): a phone that sleeps would drop the request, and the bot
 * cancels a command whose client disconnects.
 */
export function useWakeLock(active: boolean) {
  const sentinel = useRef<WakeLockSentinelLike | null>(null)
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
    if (!active || !wakeLock) return
    let cancelled = false
    const acquire = () =>
      wakeLock
        .request('screen')
        .then((lock) => (cancelled ? void lock.release() : (sentinel.current = lock)))
        .catch(() => {})
    void acquire()
    const again = () => document.visibilityState === 'visible' && void acquire()
    document.addEventListener('visibilitychange', again)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', again)
      void sentinel.current?.release().catch(() => {})
      sentinel.current = null
    }
  }, [active])
}

/** Sets the document title, which an installed app shows in its window and task switcher. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Beyond Bot` : 'Beyond Bot'
  }, [title])
}
