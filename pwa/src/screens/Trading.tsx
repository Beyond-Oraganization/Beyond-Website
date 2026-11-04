import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAction, useBot } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import { marketLabel } from '../api/intervals.ts'
import { notices } from '../api/parse/blocks.ts'
import { parseIso, parseTimeSpan } from '../api/parse/format.ts'
import { parseSignal, type SignalReading } from '../api/parse/strategies.ts'
import type { TradingSessionState } from '../api/types.ts'
import { Answer, FailurePanel } from '../components/Answer.tsx'
import { Decision } from '../components/Decision.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ConfirmSheet } from '../components/Sheet.tsx'
import { StrategyForm } from '../components/StrategyForm.tsx'
import { describeParams, initialConfig, toInput, validateConfig, type StrategyConfig } from '../strategy/config.ts'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, EmptyState, Pill, Section, Skeleton } from '../components/ui.tsx'
import { fmtClock, fmtDuration, fmtElapsed, fmtHourMinute, fmtNumber, fmtPrice, fmtRelative } from '../format.ts'
import { useNow } from '../hooks/env.ts'
import { useMarkets, useStrategies } from '../hooks/data.ts'
import { clockOffset, useSessionData } from '../hooks/session.ts'
import { type TickEntry, useLogs, useTicks } from '../state/logs.ts'
import { lastSignalWords, levelsOf, outcomeWords, plural } from '../words.ts'

function SessionCard({ session, offset, onStop }: { session: TradingSessionState; offset: number; onStop: () => void }) {
  const now = useNow(1000) + offset
  const next = parseIso(session.nextTickAt)
  const tick = session.lastTick
  const errorAt = parseIso(session.lastErrorAt)
  const tickAt = parseIso(tick?.time)
  const errorIsOld = errorAt != null && tickAt != null && errorAt < tickAt
  return (
    <li className="box stack-sm">
      <div className="spread">
        <div>
          <p className="label mute">{session.strategy}</p>
          <p className="h2">{marketLabel(session.market)}</p>
        </div>
        <div className="btn-row">
          <Link className="btn btn-ghost btn-compact" to={`/markets/${session.market.symbol}/${encodeURIComponent(marketLabel(session.market).split(' ')[1] ?? '')}`}>
            Chart
          </Link>
          <Button compact variant="danger" icon="stop" onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>
      <div className="pills">
        {Object.entries(session.parameters).map(([name, value]) => (
          <Pill key={name}>
            {name}={fmtNumber(value)}
          </Pill>
        ))}
      </div>
      {session.rules?.length ? (
        <ol className="rule-list mono" aria-label={`Rules of ${marketLabel(session.market)}, tried in order`}>
          {session.rules.map((rule, index) => (
            <li key={index}>{rule}</li>
          ))}
        </ol>
      ) : null}
      <dl className="dl">
        <dt>Next tick</dt>
        <dd>{next ? `${fmtClock(next)} UTC (${fmtRelative(next, now)})` : '–'}</dd>
        <dt>Running</dt>
        <dd>
          {fmtDuration((now - (parseIso(session.startedAt) ?? now)) / 1000)} · {plural(session.ticks, 'tick')} · {plural(session.trades, 'trade')}
        </dd>
        <dt>Last signal</dt>
        <dd>{lastSignalWords(tick)}</dd>
        {tick?.insight ? (
          <>
            <dt>Why</dt>
            <dd>{tick.insight.reason}</dd>
          </>
        ) : null}
        {tick?.candle ? (
          <>
            <dt>Last candle</dt>
            <dd>
              close {fmtPrice(tick.candle.close)}
              {levelsOf(tick.insight?.values).map((level) => ` · ${level.name} ${fmtPrice(level.value)}`)}
            </dd>
          </>
        ) : null}
      </dl>
      {session.lastError ? (
        <Callout label={errorIsOld ? 'Last error (before the last tick)' : 'Last error'} tone={errorIsOld ? undefined : 'error'}>
          <p>{session.lastError}</p>
        </Callout>
      ) : null}
    </li>
  )
}

function TickLine({ entry }: { entry: TickEntry }) {
  if (entry.kind === 'gap')
    return (
      <li>
        <span className="gap">
          {entry.market}: {entry.missed} tick{entry.missed === 1 ? '' : 's'} while this app was closed
        </span>
      </li>
    )
  const tick = entry.tick
  const parts = [
    tick.candle ? `close ${fmtPrice(tick.candle.close)}` : null,
    ...levelsOf(tick.insight?.values).map((level) => `${level.name} ${fmtPrice(level.value)}`),
    tick.outcome === 'Evaluated' || tick.outcome === 'Preview' ? `+${tick.candlesAdded} candle${tick.candlesAdded === 1 ? '' : 's'}` : null,
    tick.insight ? `${tick.outcome === 'Preview' ? 'preview: ' : 'signal '}${lastSignalWords(tick)}` : outcomeWords(tick.outcome),
    tick.trade ? (tick.trade.action === 'Opened' ? `opened ${tick.trade.order.side === 'Sell' ? 'short' : 'long'} ${fmtNumber(tick.trade.order.quantity)} @ ${fmtPrice(tick.trade.order.price)}` : `closed position ${tick.trade.order.orderId}`) : null,
    tick.error ? `tick failed: ${tick.error}` : null,
    fmtElapsed((parseTimeSpan(tick.elapsed) ?? 0) * 1000),
    `next ${fmtHourMinute(parseIso(tick.nextTickAt))}`,
  ].filter(Boolean)
  return (
    <li>
      <time dateTime={tick.time}>{fmtClock(parseIso(tick.time))}</time>
      <span>
        <strong>{marketLabel(tick.market)}</strong> │ {parts.join(' │ ')} {tick.trade ? <Pill tone="solid">trade</Pill> : null}
      </span>
    </li>
  )
}

function StartForm({ running }: { running: TradingSessionState[] }) {
  const strategies = useStrategies()
  const markets = useMarkets()
  const run = useAction()
  const [params] = useSearchParams()
  const [edited, setDraft] = useState<StrategyConfig | null>(null)
  const [touched, setTouched] = useState(false)
  const [preview, setPreview] = useState<SignalReading | null>(null)
  const [failure, setFailure] = useState<{ message: string; hint: string | null } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const definitions = strategies.data?.parsed.ok ? strategies.data.parsed.value : null
  const marketRows = markets.data?.parsed.ok ? markets.data.parsed.value : null

  const [symbol, interval] = (params.get('start') ?? '').split(' ')
  const draft = edited ?? (definitions && marketRows ? initialConfig(definitions, marketRows, { symbol, interval, strategy: params.get('strategy') }) : null)

  const definition = definitions?.find((d) => d.name === draft?.strategy)
  const errors = useMemo(() => (draft ? validateConfig(draft, definition) : {}), [draft, definition])
  const valid = Object.keys(errors).length === 0
  const replacing = draft ? running.some((s) => marketLabel(s.market) === draft.market) : false

  if (!definitions || !marketRows || !draft)
    return strategies.error || markets.error ? <FailurePanel failure={(strategies.error ?? markets.error)!} /> : <Skeleton lines={4} />

  const doPreview = async () => {
    setTouched(true)
    if (!valid) return
    setPreviewing(true)
    setFailure(null)
    try {
      const reading = parseSignal(await run(cmd.signal(toInput(draft, definition))))
      setPreview(reading.ok ? reading.value : null)
    } catch (error) {
      setFailure(error instanceof CommandFailure ? { message: error.message, hint: error.hint } : { message: String(error), hint: null })
    } finally {
      setPreviewing(false)
    }
  }

  const input = toInput(draft, definition)
  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (valid) setConfirming(true)
      }}
    >
      <StrategyForm definitions={definitions} markets={marketRows} config={draft} onChange={(next) => {
        setDraft(next)
        setPreview(null)
      }} errors={touched ? errors : {}} />
      {replacing ? (
        <Callout label="Already trading" tone="warn">
          <p>{draft.market} is being traded. Starting again replaces that session with these settings.</p>
        </Callout>
      ) : null}
      <div className="btn-row">
        <Button variant="ghost" busy={previewing} onClick={() => void doPreview()}>
          Preview the decision
        </Button>
        <Button type="submit" icon="play">
          Start trading
        </Button>
      </div>
      {failure ? <FailurePanel failure={failure} /> : null}
      {preview ? <Decision reading={preview} title={`Right now: ${preview.signalText}`} /> : null}
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={replacing ? `Replace ${draft.market}?` : `Start trading ${draft.market}?`}
        intro="The bot previews the newest candle and trades from the next close on; it keeps trading until you stop it or it logs out."
        review={[
          ['Strategy', `${definition?.name} – ${definition?.title}`],
          ['Market', draft.market],
          ['Parameters', describeParams(input)],
          ...(input.rules?.length ? [['Rules, in order', <ol key="rules" className="rule-list mono">{input.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ol>] as [string, ReactNode]] : []),
          ...(replacing ? [['Replaces', 'the session trading this market now'] as [string, string]] : []),
        ]}
        confirmLabel={replacing ? 'Replace and start' : 'Start trading'}
        onConfirm={async () => {
          const answer = await run(cmd.tradingStart(input), { invalidate: ['markets'] })
          const { done } = notices(answer)
          toast.success('Trading', done[0] ?? `${draft.market} with ${draft.strategy}`)
          const reading = parseSignal(answer)
          if (reading.ok) setPreview(reading.value)
        }}
      />
    </form>
  )
}

export default function Trading() {
  const session = useSessionData()
  const run = useAction()
  const { connection } = useBot()
  const feed = useTicks(connection?.id)
  const clear = useLogs((state) => state.clear)
  const [stopping, setStopping] = useState<TradingSessionState | 'all' | null>(null)
  const snapshot = session.data?.parsed.ok ? session.data.parsed.value : null
  const running = snapshot?.strategies ?? []
  const offset = clockOffset(session.data)

  return (
    <>
      <ScreenHead
        kicker="Trading"
        title={snapshot ? (running.length ? `${running.length} ${running.length === 1 ? 'strategy' : 'strategies'} trading.` : 'Nothing is trading.') : 'Trading'}
        lead="Strategies trade one market each, on every closed candle. Stopping always lets the tick in progress finish."
        actions={
          running.length > 1 ? (
            <Button variant="danger" icon="stop" onClick={() => setStopping('all')}>
              Stop all
            </Button>
          ) : null
        }
      />
      <Section variant="alt" label="Running strategies">
        <Answer query={session} lines={3}>
          {(value) =>
            value.strategies.length ? (
              <ul className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))' }}>
                {value.strategies.map((s) => (
                  <SessionCard key={marketLabel(s.market)} session={s} offset={offset} onStop={() => setStopping(s)} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing is trading.">Start a strategy below; the bot previews the newest candle first and never repeats a trade.</EmptyState>
            )
          }
        </Answer>
      </Section>
      <Section label="Start a strategy">
        <h2 className="h2" style={{ marginBottom: 20 }} id="start">
          Start a strategy
        </h2>
        <StartForm running={running} />
      </Section>
      <Section variant="alt" label="Ticks">
        <div className="section-title">
          <h2 className="h2">Ticks seen by this device</h2>
          {feed.length && connection ? (
            <button type="button" className="link small" onClick={() => clear(connection.id, 'ticks')}>
              Clear
            </button>
          ) : null}
        </div>
        <p className="hint" style={{ marginBottom: 16 }}>
          The bot keeps only each strategy’s last tick; this list grows while the app is open and keeps the last 500.
        </p>
        {feed.length ? (
          <ol className="feed" aria-label="Ticks, newest first">
            {[...feed].reverse().map((entry, index) => (
              <TickLine key={entry.kind === 'tick' ? `${marketLabel(entry.tick.market)}-${entry.tick.time}` : `gap-${index}`} entry={entry} />
            ))}
          </ol>
        ) : (
          <EmptyState title="No ticks yet.">They appear here as strategies tick (on each candle close).</EmptyState>
        )}
      </Section>
      <ConfirmSheet
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={stopping === 'all' ? `Stop all ${running.length} strategies?` : `Stop ${stopping ? marketLabel(stopping.market) : ''}?`}
        intro="Each stops after its tick in progress. Open positions stay open at the broker."
        review={stopping && stopping !== 'all' ? [['Strategy', stopping.strategy], ['Market', marketLabel(stopping.market)], ['Trades so far', plural(stopping.trades, 'trade')]] : running.map((s) => ['Market', `${marketLabel(s.market)} (${s.strategy})`] as [string, string])}
        confirmLabel="Stop"
        danger
        onConfirm={async () => {
          if (!stopping) return
          const [symbol, interval] = stopping === 'all' ? [] : marketLabel(stopping.market).split(' ')
          const answer = await run(cmd.tradingStop(symbol, interval), { invalidate: ['markets'] })
          toast.info('Stopped', notices(answer).done.join(' ') || 'Trading stopped.')
        }}
      />
    </>
  )
}
