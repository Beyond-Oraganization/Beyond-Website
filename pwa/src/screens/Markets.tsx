import { useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAction } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import { CTRADER_INTERVALS, expectedCandles, parseInterval } from '../api/intervals.ts'
import { notices } from '../api/parse/blocks.ts'
import { parseMarketSync, type MarketRow, type SyncRow } from '../api/parse/markets.ts'
import { Answer, FailurePanel } from '../components/Answer.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { describedBy, Field, Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ConfirmSheet } from '../components/Sheet.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, EmptyState, Pill, Section } from '../components/ui.tsx'
import { fmtCount, fmtDuration, fmtElapsed, fmtTime } from '../format.ts'
import { useNow, useWakeLock } from '../hooks/env.ts'
import { useMarkets } from '../hooks/data.ts'

const SUGGESTED = ['XAUUSD', 'XAGUSD', 'EURUSD', 'EURPLN', 'GBPUSD', 'USDJPY']
type Download = { symbol: string; interval: string; started: number; estimate: number; state: 'running' | 'done' | 'failed' | 'cancelled'; message?: string; hint?: string | null }

const stale = (row: MarketRow) => {
  const interval = parseInterval(row.interval)
  return row.age != null && interval != null && row.age * 1000 > 2 * interval.ms
}

function DownloadPanel({ download, onCancel, onResume }: { download: Download; onCancel: () => void; onResume: () => void }) {
  const now = useNow(500)
  const running = download.state === 'running'
  useWakeLock(running)
  useEffect(() => {
    if (!running) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])
  const market = `${download.symbol} ${download.interval}`
  return (
    <div className="box stack-sm" role="status" aria-live="polite">
      <div className="spread">
        <p className="h3">
          {running ? `Downloading ${market}` : download.state === 'done' ? `${market} is stored` : download.state === 'cancelled' ? 'Download cancelled' : 'Download failed'}
        </p>
        {running ? <Pill tone="solid">{fmtElapsed(now - download.started)}</Pill> : null}
      </div>
      {running ? (
        <>
          <div className="busybar" style={{ position: 'relative', top: 0 }} aria-hidden="true" />
          <p className="p">
            History since 2019: about {fmtCount(download.estimate)} candles. The bot runs one command at a time, so it answers nothing else until this is done.
          </p>
          <p className="hint">Keep the app open until it finishes: closing it cancels the download. What was stored stays, and Resume continues from there.</p>
          <div className="btn-row">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          {download.message ? <p className="p">{download.message}</p> : null}
          {download.hint ? <p className="hint">{download.hint}</p> : null}
          {download.state !== 'done' ? (
            <div className="btn-row">
              <Button icon="sync" onClick={onResume}>
                Resume (sync {market})
              </Button>
            </div>
          ) : (
            <div className="btn-row">
              <Link to={`/markets/${download.symbol}/${encodeURIComponent(download.interval)}`} className="btn btn-solid btn-compact">
                Open {market}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AddMarket({ onClose }: { onClose: () => void }) {
  const run = useAction()
  const [params] = useSearchParams()
  const symbolId = useId()
  const [symbol, setSymbol] = useState((params.get('add') ?? 'XAUUSD').toUpperCase())
  const [interval, setInterval] = useState(parseInterval(params.get('interval'))?.code ?? '1h')
  const [error, setError] = useState<string | null>(null)
  const [download, setDownload] = useState<Download | null>(null)
  const controller = useRef<AbortController | null>(null)

  const start = async (resume = false) => {
    const clean = symbol.trim().toUpperCase()
    if (!/^[A-Z0-9._-]{2,20}$/.test(clean)) return setError('Enter a symbol, like XAUUSD.')
    setError(null)
    const info = parseInterval(interval)!
    controller.current = new AbortController()
    setDownload({ symbol: clean, interval, started: Date.now(), estimate: expectedCandles(clean, info), state: 'running' })
    try {
      const answer = await run(resume ? cmd.marketSync(clean, interval) : cmd.marketAdd(clean, interval), { signal: controller.current.signal, invalidate: ['markets'] })
      const added = resume ? parseMarketSync(answer) : null
      const message = resume ? (added?.ok ? `Stored ${fmtCount(added.value[0]?.added ?? 0)} new candles.` : 'Synced.') : (notices(answer).done[0] ?? 'Stored.')
      setDownload((current) => current && { ...current, state: 'done', message })
      toast.success(`${clean} ${interval} stored`, message)
    } catch (failure) {
      const cancelled = failure instanceof CommandFailure && failure.kind === 'cancelled'
      setDownload((current) => current && { ...current, state: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'The bot kept the candles it had stored.' : (failure as Error).message, hint: failure instanceof CommandFailure ? failure.hint : null })
    }
  }

  return (
    <div className="stack">
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void start()
        }}
      >
        <Field id={symbolId} label="Symbol" error={error} hint="As your broker names it. cTrader Demo offers XAUUSD, EURUSD and EURPLN, among others.">
          <input
            id={symbolId}
            className="mono"
            list={`${symbolId}-list`}
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(symbolId, 'hint', error)}
          />
          <datalist id={`${symbolId}-list`}>
            {SUGGESTED.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Segmented name="add-interval" legend="Candle interval" value={interval} onChange={setInterval} options={CTRADER_INTERVALS.map((i) => ({ value: i.code, label: i.code }))} hint="cTrader’s intervals. 1m is a minute, 1M a month." />
        <div className="btn-row">
          <Button type="submit" icon="plus" busy={download?.state === 'running'}>
            Add and download
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={download?.state === 'running'}>
            Close
          </Button>
        </div>
      </form>
      {download ? <DownloadPanel download={download} onCancel={() => controller.current?.abort()} onResume={() => void start(true)} /> : null}
    </div>
  )
}

export default function Markets() {
  const markets = useMarkets()
  const run = useAction()
  const [params] = useSearchParams()
  const [adding, setAdding] = useState(params.has('add'))
  const [removing, setRemoving] = useState<MarketRow | null>(null)
  const [synced, setSynced] = useState<SyncRow[] | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [failure, setFailure] = useState<CommandFailure | null>(null)
  const rows = markets.data?.parsed.ok ? markets.data.parsed.value : []

  const sync = async (row?: MarketRow) => {
    setSyncing(row ? `${row.symbol} ${row.interval}` : 'all')
    setFailure(null)
    try {
      const answer = await run(row ? cmd.marketSync(row.symbol, row.interval ?? undefined) : cmd.marketSync(), { invalidate: ['markets', 'candles'] })
      const result = parseMarketSync(answer)
      setSynced(result.ok ? result.value : null)
      toast.success('Synced', result.ok ? `${fmtCount(result.value.reduce((n, r) => n + r.added, 0))} new candles` : undefined)
    } catch (error) {
      setFailure(error as CommandFailure)
    } finally {
      setSyncing(null)
    }
  }

  return (
    <>
      <ScreenHead
        kicker="Markets"
        title={rows.length ? `${rows.length} market${rows.length === 1 ? '' : 's'} stored.` : 'Markets'}
        lead="The bot keeps each market’s candles since 2019 in MySQL; strategies and backtests read them."
        actions={
          <>
            <Button icon="plus" onClick={() => setAdding(true)}>
              Add a market
            </Button>
            <Button variant="ghost" icon="sync" busy={syncing === 'all'} disabled={!rows.length} onClick={() => void sync()}>
              Sync all
            </Button>
          </>
        }
      />
      {adding ? (
        <Section variant="dark" label="Add a market">
          <h2 className="h2" style={{ marginBottom: 20 }}>
            Add a market
          </h2>
          <AddMarket onClose={() => setAdding(false)} />
        </Section>
      ) : null}
      <Section variant="alt" label="Stored markets">
        {failure ? <FailurePanel failure={failure} /> : null}
        <Answer query={markets}>
          {(value) =>
            value.length ? (
              <DataTable
                caption="Stored markets"
                rows={value}
                rowKey={(row) => `${row.symbol} ${row.interval}`}
                columns={[
                  {
                    key: 'market',
                    header: 'Market',
                    card: 'title',
                    render: (row) =>
                      row.interval ? (
                        <Link className="underline" to={`/markets/${row.symbol}/${encodeURIComponent(row.interval)}`}>
                          {row.symbol} {row.interval}
                        </Link>
                      ) : (
                        `${row.symbol} (no interval)`
                      ),
                  },
                  { key: 'state', header: 'State', card: 'sub', render: (row) => (row.trading ? <Pill tone="solid">Trading</Pill> : stale(row) ? <Pill tone="accent">Stale</Pill> : <Pill>Stored</Pill>) },
                  { key: 'candles', header: 'Candles', align: 'right', render: (row) => fmtCount(row.candles) },
                  { key: 'first', header: 'First (UTC)', render: (row) => fmtTime(row.first) },
                  { key: 'newest', header: 'Newest (UTC)', render: (row) => fmtTime(row.newest) },
                  { key: 'age', header: 'Age', align: 'right', render: (row) => fmtDuration(row.age) },
                ]}
                actions={(row) => (
                  <span className="row">
                    {row.interval ? (
                      <Button compact variant="ghost" icon="sync" busy={syncing === `${row.symbol} ${row.interval}`} onClick={() => void sync(row)}>
                        Sync
                      </Button>
                    ) : null}
                    <Button compact variant="ghost" icon="trash" disabled={row.trading} onClick={() => setRemoving(row)}>
                      Remove
                    </Button>
                  </span>
                )}
              />
            ) : (
              <EmptyState title="No markets yet." actions={<Button onClick={() => setAdding(true)}>Add XAUUSD 1h</Button>}>
                Add a market to download its history; then you can chart it, backtest it and trade it.
              </EmptyState>
            )
          }
        </Answer>
        {synced ? (
          <div style={{ marginTop: 24 }}>
            <h3 className="h3" style={{ marginBottom: 12 }}>
              Last sync
            </h3>
            <DataTable
              rows={synced}
              rowKey={(row) => row.market}
              columns={[
                { key: 'market', header: 'Market', card: 'title', render: (row) => row.market },
                { key: 'added', header: 'New candles', align: 'right', render: (row) => fmtCount(row.added) },
                { key: 'newest', header: 'Newest candle', render: (row) => `${fmtTime(row.newest)} UTC` },
                { key: 'took', header: 'Took', align: 'right', render: (row) => fmtElapsed(row.tookMs) },
              ]}
            />
          </div>
        ) : null}
      </Section>
      <Section label="About markets">
        <Callout label="Good to know">
          <p>Weekend-closed symbols (XAUUSD, XAGUSD, EURUSD, EURPLN…) never store Saturday or Sunday candles. A market that is trading cannot be removed: stop it first.</p>
        </Callout>
      </Section>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing?.interval ? `Remove ${removing.symbol} ${removing.interval}?` : `Remove all of ${removing?.symbol}?`}
        intro="The bot deletes the market and its candles from its database. Downloading them again takes a while."
        review={removing ? [['Market', removing.interval ? `${removing.symbol} ${removing.interval}` : `${removing.symbol}, every interval`], ['Candles', fmtCount(removing.candles)]] : []}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!removing) return
          const answer = await run(cmd.marketRemove(removing.symbol, removing.interval), { invalidate: ['markets'] })
          toast.info('Removed', notices(answer).done[0])
        }}
      />
    </>
  )
}
