import { useSyncExternalStore } from 'react'

/**
 * Where the app runs, for installing it:
 * - chromium: Chrome, Edge, Samsung Internet, Opera, which fire `beforeinstallprompt` and show their own dialog;
 * - ios-safari / ios-other: iPhone and iPad, where only Share → Add to Home Screen installs (iOS 16.4+ for others);
 * - mac-safari: File → Add to Dock (Safari 17+);
 * - android-firefox: the menu's Install item;
 * - desktop-firefox: cannot install (Firefox's web-app feature is experimental and Windows-only);
 * - in-app: a link opened inside another app's browser, which cannot install.
 */
export type Platform = 'chromium' | 'ios-safari' | 'ios-other' | 'mac-safari' | 'android-firefox' | 'desktop-firefox' | 'in-app' | 'other'

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|Pinterest/i

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const ipad = /Macintosh/.test(ua) && maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(ua) || ipad) {
    if (IN_APP.test(ua)) return 'in-app'
    return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\//.test(ua) ? 'ios-other' : 'ios-safari'
  }
  if (/Android/.test(ua)) {
    if (IN_APP.test(ua) || /; wv\)/.test(ua)) return 'in-app'
    if (/Firefox\//.test(ua)) return 'android-firefox'
    return 'chromium'
  }
  if (/Firefox\//.test(ua)) return 'desktop-firefox'
  if (/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua)) return 'chromium'
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'mac-safari'
  return 'other'
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallState = { standalone: boolean; canPrompt: boolean; installedNow: boolean }

let deferred: BeforeInstallPromptEvent | null = null
let installedNow = false
const listeners = new Set<() => void>()
const emit = () => {
  cached = read()
  listeners.forEach((listener) => listener())
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    (typeof matchMedia === 'function' &&
      (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches))
  )
}

const read = (): InstallState => ({ standalone: isStandalone(), canPrompt: deferred !== null, installedNow })
let cached: InstallState = { standalone: false, canPrompt: false, installedNow: false }

let started = false
/**
 * Starts listening as early as possible (main.tsx): Chrome fires `beforeinstallprompt` once, soon after load.
 * preventDefault() keeps Android's mini-bar from competing with the app's own Install button.
 */
export function startInstallWatch(onInstalled?: () => void) {
  if (started || typeof window === 'undefined') return
  started = true
  cached = read()
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    emit()
    onInstalled?.()
  })
  if (typeof matchMedia === 'function') matchMedia('(display-mode: standalone)').addEventListener('change', emit)
}

/** Opens the browser's own install dialog. "unavailable" means the browser held the event back. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  await event.prompt()
  const { outcome } = await event.userChoice
  deferred = null
  emit()
  return outcome
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => cached

export function usePlatform(): Platform {
  return typeof navigator === 'undefined' ? 'other' : detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

export function useInstall() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  const platform = usePlatform()
  const offerable = !state.standalone && (state.canPrompt || ['ios-safari', 'ios-other', 'mac-safari', 'android-firefox'].includes(platform))
  return { ...state, platform, offerable }
}

/** Test hook: lets component tests simulate the browser's events without a real install. */
export const __test = {
  reset() {
    deferred = null
    installedNow = false
    started = false
    emit()
  },
}
