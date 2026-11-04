import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { CommandData } from '../api/bot.ts'
import type { CommandFailure } from '../api/client.ts'
import type { CommandResult } from '../api/types.ts'
import { fmtClock, fmtElapsed } from '../format.ts'
import { BlockView } from './BlockView.tsx'
import { Icon } from './Icon.tsx'
import { Button, Callout, Footnote, Skeleton } from './ui.tsx'

/** A link that does what the bot's hint says, when the hint names something the app has a screen for. */
export function hintAction(hint: string | null | undefined): { to: string; label: string } | null {
  if (!hint) return null
  const add = /market add (\S+) (\S+)/.exec(hint)
  if (add) return { to: `/markets?add=${encodeURIComponent(add[1]!)}&interval=${encodeURIComponent(add[2]!)}`, label: `Add ${add[1]} ${add[2]}` }
  if (/\blogin\b|\bregister\b/.test(hint)) return { to: '/account', label: 'Sign the bot in' }
  if (/'status'/.test(hint)) return { to: '/system', label: 'Check the system' }
  if (/BEYONDBOT_API_ORIGINS|certificate|Connections/.test(hint)) return { to: '/connections', label: 'Open Connections' }
  return null
}

export function FailurePanel({ failure, onRetry, label = 'The bot said no' }: { failure: { message: string; hint?: string | null }; onRetry?: () => void; label?: string }) {
  const action = hintAction(failure.hint)
  return (
    <Callout label={label} tone="error">
      <p className="p">{failure.message}</p>
      {failure.hint ? <p className="hint">{failure.hint}</p> : null}
      {action || onRetry ? (
        <div className="btn-row">
          {action ? (
            <Link to={action.to} className="btn btn-solid btn-compact">
              {action.label}
            </Link>
          ) : null}
          {onRetry ? (
            <Button variant="ghost" compact icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </Callout>
  )
}

/** The answer as the bot printed it, for when the app cannot read it (a newer or older bot). */
export function RawAnswer({ result, reason }: { result: CommandResult; reason?: string }) {
  return (
    <div className="stack-sm">
      <p className="raw-note">
        Shown as the bot printed it{reason ? `: ${reason}` : ''}
      </p>
      <BlockView blocks={result.blocks} />
    </div>
  )
}

export const answerFootnote = (data: CommandData<unknown> | undefined, extra?: string | null) =>
  data ? <Footnote parts={[data.result.command, fmtElapsed(data.result.elapsedMs), `updated ${fmtClock(data.at)} UTC`, extra]} /> : null

/**
 * Shows a read from the bot: a skeleton while it loads, the bot's error with a way out, the raw answer when it
 * cannot be read, or the screen's own view of it. An older answer stays on screen when a refresh fails.
 */
export function Answer<T>({
  query,
  children,
  lines = 4,
  footnote = true,
}: {
  query: UseQueryResult<CommandData<T>, CommandFailure>
  children: (value: T, data: CommandData<T>) => ReactNode
  lines?: number
  footnote?: boolean
}) {
  if (query.isPending && !query.data)
    return query.fetchStatus === 'idle' ? (
      <Callout label="Not connected">
        <p>Connect a bot to see this.</p>
        <div className="btn-row">
          <Link to="/connect" className="btn btn-solid btn-compact">
            <Icon name="plug" /> Connect
          </Link>
        </div>
      </Callout>
    ) : (
      <Skeleton lines={lines} />
    )
  if (!query.data) return query.error ? <FailurePanel failure={query.error} onRetry={() => void query.refetch()} /> : <Skeleton lines={lines} />
  const data = query.data
  return (
    <div className="stack">
      {query.error ? <FailurePanel label="Could not refresh" failure={query.error} onRetry={() => void query.refetch()} /> : null}
      {data.parsed.ok ? children(data.parsed.value, data) : <RawAnswer result={data.result} reason={data.parsed.reason} />}
      {footnote ? answerFootnote(data) : null}
    </div>
  )
}
