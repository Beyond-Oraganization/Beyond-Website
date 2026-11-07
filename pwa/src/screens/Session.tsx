import { sessionName } from '../api/session.ts'
import { useState } from 'react'
import { Link } from 'react-router'
import { useAction, useCommand } from '../api/bot.ts'
import { cmd } from '../api/commands.ts'
import { intervalCode, marketLabel, parseInterval } from '../api/intervals.ts'
import { parseIso, parseTimeSpan } from '../api/parse/format.ts'
import { parseOrders } from '../api/parse/orders.ts'
import { isOrderingBug } from '../api/session.ts'
import type { PositionSnapshot, SessionSnapshot } from '../api/types.ts'
import { FailurePanel, RawAnswer } from '../components/Answer.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { ConfirmSheet } from '../components/Sheet.tsx'
import { Ticker } from '../components/Ticker.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, ButtonLink, Callout, EmptyState, Figure, MoreLink, Pill, Section, Skeleton, StatTile } from '../components/ui.tsx'
import { arrow, fmtBytes, fmtClock, fmtDuration, fmtElapsed, fmtMoney, fmtNumber, fmtPrice, fmtRelative, fmtSignedMoney, fmtSignedPercent, fmtTime, tone } from '../format.ts'
import { useNow, useTitle } from '../hooks/env.ts'
import { clockOffset, useSessionData } from '../hooks/session.ts'
import { lastSignalWords, plural } from '../words.ts'

const signedMoney = (value: number | null | undefined, currency: string) => `${arrow(value)}${fmtSignedMoney(value, currency)}`

function AccountBand({ snapshot, updatedAt }: { snapshot: SessionSnapshot; updatedAt: number }) {
  const a = snapshot.account
  const now = useNow(1000)
  return (
    <Section variant="dark" ruled labelledBy="screen-title">
      <div className="spread" style={{ marginBottom: 20 }}>
        <p className="kicker" style={{ margin: 0 }}>
          Session
        </p>
        <div className="pills">
          <Pill tone={a.mode === 'Live' ? 'accent' : 'solid'}>{a.mode === 'Live' ? 'LIVE ACCOUNT' : 'DEMO'}</Pill>
          <Pill>
            {a.broker} {a.accountId ?? ''}
          </Pill>
        </div>
      </div>
      <h1 className="vh" id="screen-title">
        Session
      </h1>
      {a.mode === 'Live' ? (
        <Callout label="Live account" tone="warn">
          <p>This bot trades a live account: orders use real money.</p>
        </Callout>
      ) : null}
      <div className="figures" style={{ marginTop: 8 }}>
        <Figure label="Equity" big value={fmtMoney(a.equity, a.currency)} sub={a.equityIsComplete ? `Balance ${fmtMoney(a.balance, a.currency)}` : 'Excludes positions in another currency'} />
      </div>
      <div className="figures" style={{ marginTop: 28 }}>
        <Figure label="Unrealized P/L" value={signedMoney(a.unrealizedProfit, a.currency)} tone={tone(a.unrealizedProfit)} />
        <Figure label="Since sign-in" value={signedMoney(a.changeSinceStart, a.currency)} sub={fmtSignedPercent(a.changeSinceStartPercent)} tone={tone(a.changeSinceStart)} />
        <Figure label="Leverage" value={a.leverage ? `1:${fmtNumber(a.leverage)}` : '–'} />
        <Figure label="Exposure" value={fmtMoney(a.exposure, a.currency)} />
      </div>
      {a.error ? (
        <div style={{ marginTop: 24 }}>
          <Callout label="The broker" tone="error">
            <p>{a.error}</p>
            <p className="hint">Stored data still works; commands that need the broker retry the connection.</p>
          </Callout>
        </div>
      ) : null}
      <p className="foot" style={{ marginTop: 20 }}>
        session --json · updated {fmtClock(updatedAt)} UTC ({fmtDuration((now - updatedAt) / 1000)} ago) · prices refresh while the app watches
      </p>
    </Section>
  )
}

function tickerItems(snapshot: SessionSnapshot): string[] {
  const a = snapshot.account
  return [
    `Equity ${fmtMoney(a.equity, a.currency)}`,
    ...snapshot.positions.map((p) => `${p.symbol} ${p.side} ${fmtNumber(p.quantity)} ${p.isPending ? 'pending' : signedMoney(p.unrealizedProfit, p.profitCurrency)}`),
    ...snapshot.strategies.map((s) => `${s.strategy} ${marketLabel(s.market)} next ${fmtClock(parseIso(s.nextTickAt)).slice(0, 5)}`),
    `Realized ${fmtSignedMoney(snapshot.stats.realizedProfit, a.currency)}`,
  ]
}

function Positions({ snapshot }: { snapshot: SessionSnapshot }) {
  const run = useAction()
  const [closing, setClosing] = useState<PositionSnapshot | null>(null)
  const converted = snapshot.positions.some((p) => p.isConverted)
  const unconverted = snapshot.positions.some((p) => !p.inAccountCurrency && !p.isPending)
  return (
    <Section label="Open positions">
      <div className="section-title">
        <h2 className="h2">Open positions</h2>
        <MoreLink to="/orders">All orders</MoreLink>
      </div>
      {snapshot.positions.length ? (
        <>
          <DataTable
            caption="Open positions and pending orders"
            rows={snapshot.positions}
            rowKey={(p) => p.id}
            columns={[
              { key: 'symbol', header: 'Symbol', card: 'title', render: (p) => p.symbol },
              { key: 'side', header: 'Side', card: 'sub', render: (p) => <Pill tone={p.side === 'Buy' ? 'solid' : undefined}>{p.side}</Pill> },
              { key: 'size', header: 'Size', align: 'right', render: (p) => fmtNumber(p.quantity) },
              { key: 'entry', header: 'Entry', align: 'right', render: (p) => fmtPrice(p.entryPrice) },
              { key: 'price', header: 'Price', align: 'right', render: (p) => fmtPrice(p.currentPrice) },
              {
                key: 'pnl',
                header: 'Unrealized P/L',
                align: 'right',
                render: (p) =>
                  p.isPending ? (
                    'pending'
                  ) : (
                    <span className={tone(p.unrealizedProfit) ?? undefined}>
                      {signedMoney(p.unrealizedProfit, p.profitCurrency)}
                      {p.isConverted ? ' ≈' : !p.inAccountCurrency ? ' *' : ''}
                    </span>
                  ),
              },
              { key: 'opened', header: 'Opened (UTC)', render: (p) => fmtTime(parseIso(p.openedAt)) },
              { key: 'id', header: 'Id', render: (p) => p.id },
            ]}
            actions={(p) => (
              <Button compact variant="ghost" onClick={() => setClosing(p)}>
                {p.isPending ? 'Cancel order' : 'Close'}
              </Button>
            )}
          />
          {converted || unconverted ? (
            <p className="hint" style={{ marginTop: 12 }}>
              {[converted && '≈ converted from the quote currency at current prices', unconverted && '* in the symbol’s quote currency (no conversion available), not included in equity']
                .filter(Boolean)
                .join('; ')}
            </p>
          ) : null}
        </>
      ) : (
        <EmptyState title="No open positions or pending orders." actions={<ButtonLink to="/orders" variant="ghost">Place an order</ButtonLink>} />
      )}
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={closing?.isPending ? 'Cancel this order?' : 'Close this position?'}
        intro={`The bot asks ${snapshot.account.broker} ${snapshot.account.mode === 'Live' ? 'LIVE' : 'DEMO'} to ${closing?.isPending ? 'cancel the order' : 'close the position at the market price'}.`}
        review={
          closing
            ? [
                ['Position', closing.id],
                ['Symbol', closing.symbol],
                ['Side', closing.side],
                ['Size', fmtNumber(closing.quantity)],
                ['Entry', fmtPrice(closing.entryPrice)],
                ['Unrealized', signedMoney(closing.unrealizedProfit, closing.profitCurrency)],
              ]
            : []
        }
        confirmLabel={closing?.isPending ? 'Cancel order' : 'Close position'}
        danger
        onConfirm={async () => {
          if (!closing) return
          await run(cmd.ordersClose(closing.id), { invalidate: ['orders-broker', 'orders-records'] })
          toast.success(closing.isPending ? 'Order cancelled' : 'Position closed', `${closing.symbol} ${closing.id}`)
        }}
      />
    </Section>
  )
}

function Strategies({ snapshot, offset }: { snapshot: SessionSnapshot; offset: number }) {
  const now = useNow(1000) + offset
  return (
    <Section variant="alt" label="Strategies">
      <div className="section-title">
        <h2 className="h2">Strategies</h2>
        <MoreLink to="/trading">Trading</MoreLink>
      </div>
      {snapshot.strategies.length ? (
        <div className="tiles">
          {snapshot.strategies.map((session) => {
            const next = parseIso(session.nextTickAt)
            return (
              <Link key={`${sessionName(session)} ${marketLabel(session.market)}`} to="/trading" className="tile">
                <span className="label mute">{sessionName(session) === session.strategy ? session.strategy : `${sessionName(session)} · ${session.strategy}`}</span>
                <span className="h3">{marketLabel(session.market)}</span>
                <span className="mono small">Last signal: {lastSignalWords(session.lastTick)}</span>
                <span className="mono small">
                  Next tick {next ? `${fmtClock(next)} UTC (${fmtRelative(next, now)})` : '–'}
                </span>
                <span className="mono small">
                  {plural(session.ticks, 'tick')} · {plural(session.trades, 'trade')}
                </span>
                {session.lastError ? <span className="field-error small">{session.lastError}</span> : null}
              </Link>
            )
          })}
        </div>
      ) : (
        <EmptyState title="Nothing is trading." actions={<ButtonLink to="/trading">Start a strategy</ButtonLink>}>
          Start a strategy on a stored market; it trades until you stop it or the bot logs out.
        </EmptyState>
      )}
    </Section>
  )
}

function Stats({ snapshot }: { snapshot: SessionSnapshot }) {
  const s = snapshot.stats
  const currency = snapshot.account.currency
  const closes = s.wins + s.losses
  return (
    <Section label="Session statistics">
      <h2 className="h2" style={{ marginBottom: 20 }}>
        Since sign-in
      </h2>
      <div className="tiles">
        <StatTile label="Trades" value={`${s.tradesOpened} / ${s.tradesClosed}`} sub="opened / closed by strategies" />
        <StatTile label="Realized P/L" value={signedMoney(s.realizedProfit, currency)} tone={tone(s.realizedProfit)} sub="every close at the broker" />
        <StatTile label="Wins / losses" value={`${s.wins} / ${s.losses}`} sub={closes ? `win rate ${((s.wins / closes) * 100).toFixed(1)}%` : 'no closes yet'} />
        <StatTile label="Start balance" value={fmtMoney(s.startBalance, currency)} sub={`signed in as ${s.user ?? '–'}`} />
        <StatTile label="Started" value={fmtTime(parseIso(s.startedAt))} sub={`UTC, up ${fmtDuration(parseTimeSpan(s.uptime))}`} />
      </div>
    </Section>
  )
}

function SystemStrip({ snapshot }: { snapshot: SessionSnapshot }) {
  const sys = snapshot.system
  const latency = parseTimeSpan(sys.broker.lastLatency)
  return (
    <Section variant="alt" label="System">
      <div className="section-title">
        <h2 className="h2">System</h2>
        <MoreLink to="/system">Details</MoreLink>
      </div>
      <dl className="dl">
        <dt>Broker</dt>
        <dd>{sys.broker.isConnected ? `connected${latency != null ? `, ${fmtElapsed(latency * 1000)}` : ''}` : `disconnected${sys.broker.lastError ? `: ${sys.broker.lastError}` : ''}`}</dd>
        <dt>Database</dt>
        <dd>{sys.database ? (sys.database.isConnected ? `${sys.database.database}@${sys.database.server}, schema v${sys.database.schemaVersion}` : `unavailable: ${sys.database.error ?? ''}`) : 'not checked'}</dd>
        <dt>Market data</dt>
        <dd>
          {sys.markets.length
            ? sys.markets.map((m) => {
                const age = parseTimeSpan(m.age)
                const stale = age != null && age * 1000 > 2 * (parseInterval(m.market.interval)?.ms ?? Infinity)
                return (
                  <span key={marketLabel(m.market)} className="nowrap" style={{ marginRight: 16 }}>
                    {m.market.symbol} {intervalCode(m.market.interval)} {age != null ? `(${fmtDuration(age)} old)` : '(empty)'}
                    {stale ? ' ' : ''}
                    {stale ? <Pill tone="accent">Stale</Pill> : null}
                  </span>
                )
              })
            : 'none loaded'}
        </dd>
        <dt>Version</dt>
        <dd>
          {sys.version}, up {fmtDuration(parseTimeSpan(sys.processUptime))}
        </dd>
        <dt>Memory</dt>
        <dd>
          {fmtBytes(sys.managedMemoryBytes)} managed, {fmtBytes(sys.workingSetBytes)} working set
        </dd>
      </dl>
    </Section>
  )
}

/** When the bot cannot build its session view, the broker's positions still answer. */
function OrderingBug({ message }: { message: string }) {
  const broker = useCommand('orders-broker', cmd.ordersList({ broker: true }), parseOrders)
  return (
    <>
      <Section variant="dark" labelledBy="screen-title">
        <p className="kicker">Session</p>
        <h1 className="title" id="screen-title">
          The bot cannot show its session.
        </h1>
        <div style={{ marginTop: 24, maxWidth: '44em' }}>
          <Callout label="A known bot bug" tone="error">
            <p>{message}</p>
            <p className="hint">
              The bot fails to build its session view as soon as two or more markets are in memory (for example after a backtest of a second market). Trading is not affected. Restarting the bot clears it until then; the fix belongs in the bot (Session/SystemProbe.cs).
            </p>
          </Callout>
        </div>
      </Section>
      <Section label="Positions at the broker">
        <h2 className="h2" style={{ marginBottom: 16 }}>
          Positions at the broker
        </h2>
        {broker.data?.parsed.ok ? (
          <DataTable
            rows={broker.data.parsed.value}
            rowKey={(o) => o.id}
            caption="Positions at the broker"
            columns={[
              { key: 'symbol', header: 'Symbol', card: 'title', render: (o) => o.symbol },
              { key: 'side', header: 'Side', card: 'sub', render: (o) => o.side },
              { key: 'id', header: 'Id', render: (o) => o.id },
              { key: 'qty', header: 'Quantity', align: 'right', render: (o) => fmtNumber(o.quantity) },
              { key: 'price', header: 'Price', align: 'right', render: (o) => fmtPrice(o.price) },
              { key: 'status', header: 'Status', render: (o) => o.status },
            ]}
          />
        ) : broker.error ? (
          <FailurePanel failure={broker.error} />
        ) : (
          <Skeleton />
        )}
        <div className="btn-row" style={{ marginTop: 20 }}>
          <ButtonLink to="/orders" variant="ghost">
            Close or cancel in Orders
          </ButtonLink>
        </div>
      </Section>
    </>
  )
}

export default function Session() {
  useTitle('Session')
  const query = useSessionData()
  const data = query.data
  const error = query.error

  if (!data) {
    if (error?.kind === 'signedOut')
      return (
        <Section variant="dark" labelledBy="screen-title">
          <p className="kicker">Session</p>
          <h1 className="title" id="screen-title">
            No trading account yet.
          </h1>
          <p className="lead on-band" style={{ marginTop: 16 }}>
            This device reaches a trading account only after signing in to it with the account’s password, even one the bot is already trading. Markets and backtests work without one.
          </p>
          <div className="btn-row" style={{ marginTop: 28 }}>
            <ButtonLink to="/account">Add a trading account</ButtonLink>
            <ButtonLink to="/markets" variant="ghost">
              Markets
            </ButtonLink>
          </div>
        </Section>
      )
    if (error && isOrderingBug(error.message)) return <OrderingBug message={error.message} />
    return (
      <Section variant="dark" labelledBy="screen-title">
        <p className="kicker">Session</p>
        <h1 className="title" id="screen-title">
          {error ? 'No session yet.' : 'Reading the session…'}
        </h1>
        <div style={{ marginTop: 24 }}>{error ? <FailurePanel failure={error} onRetry={() => void query.refetch()} /> : <Skeleton lines={3} />}</div>
      </Section>
    )
  }

  if (!data.parsed.ok)
    return (
      <Section labelledBy="screen-title">
        <p className="kicker">Session</p>
        <h1 className="title" id="screen-title">
          Session
        </h1>
        <div style={{ marginTop: 24 }}>
          <RawAnswer result={data.result} reason={data.parsed.reason} />
        </div>
      </Section>
    )

  const snapshot = data.parsed.value
  return (
    <>
      <AccountBand snapshot={snapshot} updatedAt={data.at} />
      <Ticker items={tickerItems(snapshot)} />
      {error ? (
        <Section label="Refresh problem">
          {isOrderingBug(error.message) ? (
            <Callout label="The last refresh failed" tone="error">
              <p>{error.message}</p>
              <p className="hint">A known bot bug: its session view fails while two or more markets are in memory. The figures below are from {fmtClock(data.at)} UTC.</p>
            </Callout>
          ) : (
            <FailurePanel label="Could not refresh" failure={error} onRetry={() => void query.refetch()} />
          )}
        </Section>
      ) : null}
      <Positions snapshot={snapshot} />
      <Strategies snapshot={snapshot} offset={clockOffset(data)} />
      <Stats snapshot={snapshot} />
      <SystemStrip snapshot={snapshot} />
    </>
  )
}
