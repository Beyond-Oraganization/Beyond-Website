import type { ReactNode } from 'react'
import { useTitle } from '../hooks/env.ts'
import { Breadcrumbs, Section } from './ui.tsx'

/** A screen's opening band: breadcrumbs, the red kicker, the big uppercase title, its status line, its actions. */
export function ScreenHead({
  kicker,
  title,
  lead,
  actions,
  crumbs,
  variant = 'default',
  children,
}: {
  kicker: string
  title: string
  lead?: ReactNode
  actions?: ReactNode
  crumbs?: { label: string; to?: string }[]
  variant?: 'default' | 'alt' | 'dark'
  children?: ReactNode
}) {
  useTitle(crumbs?.at(-1)?.label ?? kicker)
  return (
    <Section variant={variant} ruled labelledBy="screen-title">
      {crumbs ? <Breadcrumbs trail={crumbs} /> : null}
      <div className="screen-head">
        <div className="rise">
          <p className="kicker">{kicker}</p>
          <h1 className="title" id="screen-title">
            {title}
          </h1>
          {lead ? <div className={variant === 'dark' ? 'lead on-band' : 'lead'}>{lead}</div> : null}
        </div>
        {actions ? <div className="btn-row">{actions}</div> : null}
      </div>
      {children ? <div style={{ marginTop: 28 }}>{children}</div> : null}
    </Section>
  )
}
