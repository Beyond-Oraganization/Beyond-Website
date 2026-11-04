import type { ManifestOptions } from 'vite-plugin-pwa'

/**
 * Browsers resolve a relative manifest `id` against the origin, not the app's folder. Every GitHub Pages site
 * of the organisation shares https://beyond-oraganization.github.io, so the id names the app's path explicitly.
 */
export const DEFAULT_APP_ID = '/Beyond-Website/app/'

export const NAME = 'Beyond Bot'
export const DESCRIPTION =
  'Watch and drive your Beyond Bot: account, positions, strategies, markets, backtests and orders.'
export const NAVY = '#003049'

const shortcut = (name: string, route: string, icon: string, description: string) => ({
  name,
  short_name: name,
  description,
  url: `./#${route}`,
  icons: [{ src: `shortcuts/${icon}-96.png`, sizes: '96x96', type: 'image/png' }],
})

export function manifest(appId: string = DEFAULT_APP_ID): Partial<ManifestOptions> {
  return {
    id: appId,
    name: NAME,
    short_name: NAME,
    description: DESCRIPTION,
    start_url: './#/',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    lang: 'en',
    dir: 'ltr',
    theme_color: NAVY,
    background_color: NAVY,
    categories: ['finance'],
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      shortcut('Session', '/', 'session', 'Account, positions and running strategies'),
      shortcut('Trading', '/trading', 'trading', 'Start and stop strategies'),
      shortcut('Markets', '/markets', 'markets', 'Stored markets and charts'),
      shortcut('Backtest', '/backtest', 'backtest', 'Replay a strategy over stored candles'),
    ],
    screenshots: [
      { src: 'screenshots/session-narrow.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Session: account, positions and strategies' },
      { src: 'screenshots/trading-narrow.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Trading: running strategies and their ticks' },
      { src: 'screenshots/backtest-narrow.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Backtest: a report with the balance over time' },
      { src: 'screenshots/session-wide.png', sizes: '1600x1000', type: 'image/png', form_factor: 'wide', label: 'Session on a computer' },
      { src: 'screenshots/market-wide.png', sizes: '1600x1000', type: 'image/png', form_factor: 'wide', label: 'A market with its candles and bands' },
    ],
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
  }
}
