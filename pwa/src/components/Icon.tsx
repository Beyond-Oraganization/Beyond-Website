import type { SVGProps } from 'react'

/** The website's icon style: a 24-unit grid, 2.2 stroke, round caps and joins, drawn in currentColor. */
const paths = {
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9ZM12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5M5.3 5.3L7 7M17 17L18.7 18.7M18.7 5.3L17 7M7 17L5.3 18.7',
  menu: 'M3.5 6.5H20.5M3.5 12H20.5M3.5 17.5H20.5',
  close: 'M6 6L18 18M18 6L6 18',
  back: 'M10 5L3 12L10 19M3 12H21',
  refresh: 'M20 11A8 8 0 1 0 17.7 17.6M20 4.5V11H13.5',
  install: 'M12 3.5V14.5M7.5 10L12 14.5L16.5 10M4 15.5V20H20V15.5',
  settings:
    'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2.1 1.2l-.3 2h-3.9l-.3-2a7 7 0 0 1-2.1-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.9L2.6 9.4l2-3.4 1.9.7a7 7 0 0 1 2.1-1.2l.3-2h3.9l.3 2a7 7 0 0 1 2.1 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.9Z',
  session: 'M2.5 12Q12 3.5 21.5 12Q12 20.5 2.5 12ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z',
  trading: 'M12 2.5V6.5M12 17.5V21.5M8 6.5H16V17.5H8Z',
  markets: 'M6 4V20M12 2.5V16M18 7V21M4 8H8V16H4ZM10 5H14V12H10ZM16 10H20V17H16Z',
  backtest: 'M6.5 7.5A8 8 0 1 1 4.5 14M3 5.5L6.5 7.5L8 4M12 8V12.5L15 15',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  orders: 'M8 6H20M8 12H20M8 18H20M4 6h.01M4 12h.01M4 18h.01',
  strategies: 'M4 6H13M17 6H20M4 12H7M11 12H20M4 18H15M19 18H20M15 4V8M9 10V14M17 16V20',
  console: 'M4 5H20V19H4ZM7.5 9.5L10.5 12L7.5 14.5M12.5 15H16.5',
  system: 'M2.5 12H7L9.5 5.5L14 18.5L16.5 12H21.5',
  account: 'M12 3.5a4 4 0 1 0 0 8a4 4 0 1 0 0-8ZM4 20.5Q4 14.5 12 14.5Q20 14.5 20 20.5',
  plug: 'M9 2.5V7M15 2.5V7M6.5 7H17.5V11A5.5 5.5 0 0 1 6.5 11ZM12 16.5V21.5',
  lock: 'M6 11H18V20.5H6ZM8.5 11V7.5A3.5 3.5 0 0 1 15.5 7.5V11',
  copy: 'M8 8H19V19H8ZM5 16V5H16',
  play: 'M7 4.5L19 12L7 19.5Z',
  stop: 'M6 6H18V18H6Z',
  plus: 'M12 4.5V19.5M4.5 12H19.5',
  trash: 'M4 6.5H20M9.5 6.5V4H14.5V6.5M6.5 6.5L7.5 20.5H16.5L17.5 6.5M10 10.5V16.5M14 10.5V16.5',
  sync: 'M4 12A8 8 0 0 1 18 6.7M18 3V7H14M20 12A8 8 0 0 1 6 17.3M6 21V17H10',
  check: 'M4.5 12.5L9.5 17.5L19.5 6.5',
  warning: 'M12 3L22 20H2ZM12 9.5V14M12 17h.01',
  external: 'M14 4H20V10M20 4L11 13M18 14V20H4V6H10',
  share: 'M12 3.5V15M7.5 8L12 3.5L16.5 8M6 11H4.5V20.5H19.5V11H18',
  addsquare: 'M4 4H20V20H4ZM12 8V16M8 12H16',
  arrow: 'M0 6H26M21 1L26 6L21 11',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, title, ...rest }: { name: IconName; title?: string } & SVGProps<SVGSVGElement>) {
  const wide = name === 'arrow'
  return (
    <svg
      viewBox={wide ? '0 0 28 12' : '0 0 24 24'}
      width={wide ? 28 : 20}
      height={wide ? 12 : 20}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={paths[name]} />
    </svg>
  )
}

/** The Beyond Bot glyph from the website's techbot page: a candlestick with an eye in its body. */
export function BotMark({ size = 40, title }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 240 240" width={size} height={size} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} focusable="false">
      {title ? <title>{title}</title> : null}
      <path d="M120 40V84M120 156V200" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
      <rect x="70" y="84" width="100" height="72" rx="14" fill="currentColor" />
      <path d="M86 120Q120 92 154 120Q120 148 86 120Z" fill="none" stroke="var(--bg)" strokeWidth="8" strokeLinejoin="round" />
      <circle cx="120" cy="120" r="10" fill="var(--bg)" />
    </svg>
  )
}
