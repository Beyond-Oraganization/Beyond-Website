import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from './Icon.tsx'

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

/** A full-width band, like the website's `.sec`: it sets the local colours every component reads. */
export function Section({
  variant = 'default',
  ruled = false,
  className,
  children,
  labelledBy,
  label,
}: {
  variant?: 'default' | 'alt' | 'dark'
  ruled?: boolean
  className?: string
  children: ReactNode
  labelledBy?: string
  label?: string
}) {
  return (
    <section
      className={cx('sec', variant !== 'default' && variant, ruled && 'ruled', className)}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {ruled ? <RouteRuler /> : null}
      <div className="wrap">{children}</div>
    </section>
  )
}

/** The website's left-margin ruler with its eye marker; decorative, wide screens only. */
export function RouteRuler() {
  return (
    <>
      <div className="rl" aria-hidden="true" />
      <div className="rt" aria-hidden="true" />
      <svg className="rn" viewBox="-12 -7 24 14" width="24" height="14" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M-11 0Q0 -9 11 0Q0 9 -11 0Z" />
          <circle r="3.4" />
          <circle r="1.3" fill="currentColor" />
        </g>
      </svg>
    </>
  )
}

export const Kicker = ({ children }: { children: ReactNode }) => <p className="kicker">{children}</p>

export const Label = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx('label', className)}>{children}</span>
)

export function Pill({ children, tone, dot }: { children: ReactNode; tone?: 'solid' | 'accent'; dot?: boolean }) {
  return <span className={cx('pill', tone, dot && 'dot')}>{children}</span>
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'ghost' | 'danger'
  compact?: boolean
  busy?: boolean
  icon?: IconName
}

export function Button({ variant = 'solid', compact, busy, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, compact && 'btn-compact', className)}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

export function ButtonLink({ to, variant = 'solid', compact, icon, children }: { to: string; variant?: 'solid' | 'ghost'; compact?: boolean; icon?: IconName; children: ReactNode }) {
  return (
    <Link to={to} className={cx('btn', `btn-${variant}`, compact && 'btn-compact')}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  )
}

export function IconButton({ icon, label, showLabel, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; showLabel?: boolean }) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={showLabel ? undefined : label} title={label} {...rest}>
      <Icon name={icon} />
      {showLabel ? <span className="label-text">{label}</span> : null}
    </button>
  )
}

/** The website's arrow link (`.more`). */
export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="more">
      {children}
      <Icon name="arrow" />
    </Link>
  )
}

export function Callout({ label, tone, children }: { label?: string; tone?: 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={cx('callout', tone)} role={tone === 'error' ? 'alert' : undefined}>
      {label ? <span className="label">{label}</span> : null}
      <div className="stack-sm">{children}</div>
    </div>
  )
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <p className="h3">{title}</p>
      {children ? <div className="p mute">{children}</div> : null}
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  )
}

/** A key figure: label, big value, a line below. */
export function Figure({ label, value, sub, big, tone }: { label: string; value: ReactNode; sub?: ReactNode; big?: boolean; tone?: 'gain' | 'loss' | null }) {
  return (
    <div className="figure">
      <span className="label">{label}</span>
      <span className={cx('value', big && 'big', tone)}>{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  )
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gain' | 'loss' | null }) {
  return (
    <div className="tile stat">
      <span className="label">{label}</span>
      <span className={cx('value', tone)}>{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  )
}

export function Breadcrumbs({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((step, i) => (
        <span key={step.label} style={{ display: 'contents' }}>
          {i > 0 ? <span className="sep" aria-hidden="true">/</span> : null}
          {step.to ? <Link to={step.to}>{step.label}</Link> : <span className="here" aria-current="page">{step.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/** The command behind the data on screen, and how long the bot took: "market list · 12 ms · 14:03:21". */
export function Footnote({ parts }: { parts: (string | null | undefined | false)[] }) {
  const shown = parts.filter(Boolean)
  return shown.length ? <p className="foot">{shown.join(' · ')}</p> : null
}

export const Skeleton = ({ lines = 3 }: { lines?: number }) => (
  <div className="stack-sm" aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => (
      <span key={i} className="skeleton" style={{ width: `${92 - i * 14}%`, height: 22 }} />
    ))}
  </div>
)

export { cx }
