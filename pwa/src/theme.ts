import { useSyncExternalStore } from 'react'

/** The website's two themes. Classic (yellow, navy) is the default, as on the site. */
export type Theme = 'classic' | 'light'

/** Shared with the website (same origin), so a theme chosen there carries over to the app and back. */
export const THEME_KEY = 'beyondia-theme'
/** App only: follow the device (light → Light, dark → Classic). */
export const SYSTEM_KEY = 'beyond-bot:theme-system'
export const THEME_COLOR: Record<Theme, string> = { classic: '#003049', light: '#F4BF96' }

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // private mode: the choice just is not remembered
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode
  }
}

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null)

export const systemTheme = (): Theme => (darkQuery()?.matches ? 'classic' : 'light')
export const followsSystem = () => read(SYSTEM_KEY) === '1'
export const currentTheme = (): Theme =>
  document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'classic'

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  emit()
}

export function setTheme(theme: Theme) {
  write(THEME_KEY, theme)
  write(SYSTEM_KEY, '0')
  applyTheme(theme)
}

export function setFollowSystem(on: boolean) {
  write(SYSTEM_KEY, on ? '1' : '0')
  applyTheme(on ? systemTheme() : read(THEME_KEY) === 'light' ? 'light' : 'classic')
}

/** Keeps the page in step with the device's setting while "Follow the system" is on. */
export function watchSystemTheme(): () => void {
  const query = darkQuery()
  if (!query) return () => {}
  const onChange = () => {
    if (followsSystem()) applyTheme(systemTheme())
  }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'classic' as Theme)
  const system = useSyncExternalStore(subscribe, followsSystem, () => false)
  return {
    theme,
    followSystem: system,
    toggle: () => setTheme(theme === 'light' ? 'classic' : 'light'),
    setTheme,
    setFollowSystem,
  }
}
