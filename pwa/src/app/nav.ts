import type { IconName } from '../components/Icon.tsx'

export type NavItem = { to: string; label: string; icon: IconName; end?: boolean }

/** The screens, in the header's order; the first four are the phone's bottom bar. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Session', icon: 'session', end: true },
  { to: '/trading', label: 'Trading', icon: 'trading' },
  { to: '/markets', label: 'Markets', icon: 'markets' },
  { to: '/backtest', label: 'Backtest', icon: 'backtest' },
  { to: '/orders', label: 'Orders', icon: 'orders' },
  { to: '/strategies', label: 'Strategies', icon: 'strategies' },
  { to: '/console', label: 'Console', icon: 'console' },
  { to: '/system', label: 'System', icon: 'system' },
]

/** What the phone's More sheet holds. */
export const MORE: NavItem[] = [
  ...NAV.slice(4),
  { to: '/account', label: 'Bot account', icon: 'account' },
  { to: '/connections', label: 'Connections', icon: 'plug' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/install', label: 'Install the app', icon: 'install' },
]
