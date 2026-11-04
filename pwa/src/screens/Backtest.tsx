import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAction, useBot } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd, type StrategyInput } from '../api/commands.ts'
import { parseBacktest, type BacktestReport } from '../api/parse/strategies.ts'
import { FailurePanel } from '../components/Answer.tsx'
import { Chart } from '../components/Chart.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { describedBy, Field } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { StrategyForm, initialDraft, toInput, validateDraft, type StrategyDraft } from '../components/StrategyForm.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, EmptyState, Section, Skeleton, StatTile } from '../components/ui.tsx'
import { arrow, fmtCount, fmtElapsed, fmtMoney, fmtPercent, fmtSignedMoney, fmtSignedPercent, fmtTime, tone } from '../format.ts'
import { useMarkets, useStrategies } from '../hooks/data.ts'
import { useMemoryWarning } from '../hooks/memory.ts'
import { db } from '../state/db.ts'
import { useSettings } from '../state/settings.ts'

type Curve = { time: number; balance: number }[]
type SavedRun = { id: string; at: number; input: StrategyInput; balance: number; report: BacktestReport; curve: Curve | null }

const dateOrNull = (text: string) => (text ? Date.parse(`${text}T00:00:00Z`) : null)

function Report({ report }: { report: BacktestReport }) {
  return (
    <div className="tiles">
      <StatTile label="Profit / loss" value={`${arrow(report.profitLoss)}${fmtSignedMoney(report.profitLoss)}`} sub={fmtSignedPercent(report.returnPercent)} tone={tone(report.profitLoss)} />
      <StatTile label="Balance" value={fmtMoney(report.finalBalance)} sub={`from ${fmtMoney(report.initialBalance)}`} />
      <StatTile label="Trades" value={`${report.trades} closed`} sub={`${report.won} won, ${report.lost} lost, win rate ${fmtPercent(report.winRate, 1)}`} />
      <StatTile label="Average per trade" value={fmtSignedMoney(report.average)} tone={tone(report.average)} />
      <StatTile label="Best trade" value={fmtSignedMoney(report.best)} sub={fmtPercent(report.bestPercent)} />
      <StatTile label="Max drawdown" value={fmtSignedMoney(report.maxDrawdown)} sub={fmtPercent(report.maxDrawdownPercent)} tone={report.maxDrawdown ? 'loss' : null} />
      <StatTile label="Period" value={`${fmtCount(report.candles)} candles`} sub={`${fmtTime(report.start)} → ${fmtTime(report.end)} UTC`} />
      {report.stillOpen ? <StatTile label="Still open" value={`${report.stillOpen} position(s)`} sub="not counted in the balance" /> : null}
      <StatTile label="Computed in" value={fmtElapsed(report.computedMs)} sub={report.parameters ?? ''} />
    </div>
  )
}

export default function Backtest() {
  const strategies = useStrategies()
  const markets = useMarkets()
  const run = useAction()
  const { connection } = useBot()
  const [params] = useSearchParams()
  const samples = useSettings((state) => state.equitySamples)
  const [edited, setDraft] = useState<StrategyDraft | null>(null)
  const [balance, setBalance] = useState('1000')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<CommandFailure | null>(null)
  const [current, setCurrent] = useState<SavedRun | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [saved, setSaved] = useState<SavedRun[]>([])
  const [compare, setCompare] = useState<string[]>([])
  const stopCurve = useRef<AbortController | null>(null)
  const ids = { balance: useId(), from: useId(), to: useId() }

  const definitions = strategies.data?.parsed.ok ? strategies.data.parsed.value : null
  const rows = markets.data?.parsed.ok ? markets.data.parsed.value : null
  const [symbol, interval] = (params.get('market') ?? '').split(' ')
  const draft = edited ?? (definitions && rows ? initialDraft(definitions, rows, { symbol, interval }) : null)
  useEffect(() => {
    if (connection) void db.get<SavedRun[]>(`backtests:${connection.id}`).then((list) => setSaved(list ?? []))
  }, [connection])

  const definition = definitions?.find((d) => d.name === draft?.strategy)
  const errors = useMemo(() => {
    const found = draft ? validateDraft(draft, definition) : {}
    if (!(Number(balance) > 0)) found.balance = 'The starting balance must be above 0.'
    if (from && to && from >= to) found.to = 'The end must be after the start.'
    return found
  }, [draft, definition, balance, from, to])
  const warning = useMemoryWarning(draft?.market ?? null)

  const persist = async (list: SavedRun[]) => {
    setSaved(list)
    if (connection) await db.set(`backtests:${connection.id}`, list.slice(-50))
  }

  const start = async () => {
    setTouched(true)
    if (!draft || Object.keys(errors).length) return
    setBusy(true)
    setFailure(null)
    try {
      const input = toInput(draft)
      const answer = await run(cmd.backtest(input, { balance: Number(balance), from: dateOrNull(from), to: dateOrNull(to) }), { invalidate: [] })
      const report = parseBacktest(answer)
      if (!report.ok) throw new Error(report.reason)
      const entry: SavedRun = { id: `${Date.now()}`, at: Date.now(), input, balance: Number(balance), report: report.value, curve: null }
      setCurrent(entry)
      await persist([...saved, entry])
    } catch (error) {
      setFailure(error instanceof CommandFailure ? error : new CommandFailure({ kind: 'badResponse', status: 200, reason: (error as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  /** The balance at evenly spaced cuts: the same backtest, ending earlier. Exact at each cut (closed trades only). */
  const drawCurve = async () => {
    if (!current?.report.start || !current.report.end) return
    const startAt = current.report.start
    const endAt = current.report.end
    const controller = new AbortController()
    stopCurve.current = controller
    const curve: Curve = [{ time: startAt, balance: current.balance }]
    setProgress({ done: 0, total: samples })
    try {
      for (let i = 1; i <= samples; i++) {
        if (controller.signal.aborted) break
        const cut = i === samples ? endAt : Math.round(startAt + ((endAt - startAt) * i) / samples)
        const answer = await run(cmd.backtest(current.input, { balance: current.balance, from: startAt, to: cut }), { signal: controller.signal, invalidate: [] })
        const report = parseBacktest(answer)
        if (report.ok) curve.push({ time: cut, balance: report.value.finalBalance })
        setProgress({ done: i, total: samples })
      }
      const entry = { ...current, curve }
      setCurrent(entry)
      await persist(saved.map((run) => (run.id === entry.id ? entry : run)))
    } catch (error) {
      if (!(error instanceof CommandFailure && error.kind === 'cancelled')) toast.error('The curve stopped', (error as Error).message)
    } finally {
      setProgress(null)
      stopCurve.current = null
    }
  }

  const compared = saved.filter((run) => compare.includes(run.id))

  return (
    <>
      <ScreenHead kicker="Backtest" title="Replay a strategy." lead="The bot replays the strategy over its stored candles with a simulated account, in memory, in well under a second. It works without signing in." />
      <Section variant="alt" label="Backtest settings">
        {!definitions || !rows || !draft ? (
          strategies.error || markets.error ? <FailurePanel failure={(strategies.error ?? markets.error)!} /> : <Skeleton lines={5} />
        ) : (
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void start()
            }}
          >
            <StrategyForm definitions={definitions} markets={rows} draft={draft} onChange={setDraft} errors={touched ? errors : {}} />
            <div className="form-grid">
              <Field id={ids.balance} label="Starting balance" error={touched ? errors.balance : undefined} hint="Simulated; no currency.">
                <input id={ids.balance} className="mono" type="number" min="1" step="any" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} aria-describedby={describedBy(ids.balance, 'hint', touched ? errors.balance : null)} />
              </Field>
              <Field id={ids.from} label="From (UTC, optional)" hint="The first stored candle when empty.">
                <input id={ids.from} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-describedby={describedBy(ids.from, 'hint')} />
              </Field>
              <Field id={ids.to} label="To (UTC, optional)" error={touched ? errors.to : undefined} hint="Now when empty.">
                <input id={ids.to} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-describedby={describedBy(ids.to, 'hint', touched ? errors.to : null)} />
              </Field>
            </div>
            {warning ? (
              <Callout label="Memory" tone="warn">
                <p>{warning}</p>
              </Callout>
            ) : null}
            <div className="btn-row">
              <Button type="submit" busy={busy} icon="backtest">
                Run the backtest
              </Button>
            </div>
            {failure ? <FailurePanel failure={failure} /> : null}
          </form>
        )}
      </Section>
      {current ? (
        <Section label="Report">
          <div className="section-title">
            <h2 className="h2">
              {current.report.strategy} on {current.report.market}
            </h2>
          </div>
          <div className="stack">
            <Report report={current.report} />
            <div className="stack-sm">
              <h3 className="h3">Balance over time</h3>
              {current.curve ? (
                <Chart
                  lines={[{ name: 'Balance', points: current.curve.map((p) => ({ time: p.time, value: p.balance })), width: 3 }]}
                  label={`Balance from ${fmtMoney(current.curve[0]?.balance)} to ${fmtMoney(current.curve.at(-1)?.balance)} over ${current.curve.length - 1} cuts`}
                  height={300}
                />
              ) : (
                <p className="p">
                  The bot’s report has no trade list, so the curve comes from {samples} more backtests that end earlier. Each is exact at its cut: the simulation only uses the past, and counts closed trades.
                </p>
              )}
              <div className="btn-row">
                {progress ? (
                  <>
                    <Button busy>
                      {progress.done} of {progress.total}
                    </Button>
                    <Button variant="ghost" onClick={() => stopCurve.current?.abort()}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant={current.curve ? 'ghost' : 'solid'} onClick={() => void drawCurve()}>
                    {current.curve ? 'Draw it again' : 'Draw the balance over time'}
                  </Button>
                )}
              </div>
            </div>
            <Callout label="What a backtest leaves out">
              <p>No fees, spread or margin. Positions still open at the end are not in the balance. Live trading runs the same decision code, so a backtest and the live strategy cannot drift apart.</p>
            </Callout>
          </div>
        </Section>
      ) : null}
      <Section variant="alt" label="Saved runs">
        <div className="section-title">
          <h2 className="h2">Saved runs</h2>
          {saved.length ? (
            <button type="button" className="link small" onClick={() => void persist([])}>
              Clear
            </button>
          ) : null}
        </div>
        {saved.length ? (
          <div className="stack">
            <DataTable
              caption="Saved backtests"
              rows={[...saved].reverse()}
              rowKey={(run) => run.id}
              columns={[
                { key: 'market', header: 'Market', card: 'title', render: (run) => run.report.market },
                { key: 'pl', header: 'Profit / loss', card: 'sub', align: 'right', render: (run) => <span className={tone(run.report.profitLoss) ?? undefined}>{fmtSignedPercent(run.report.returnPercent)}</span> },
                { key: 'params', header: 'Parameters', wrap: true, render: (run) => run.report.parameters ?? '' },
                { key: 'trades', header: 'Trades', align: 'right', render: (run) => run.report.trades },
                { key: 'dd', header: 'Max drawdown', align: 'right', render: (run) => fmtPercent(run.report.maxDrawdownPercent) },
                { key: 'when', header: 'Run', render: (run) => fmtTime(run.at) },
              ]}
              actions={(run) => (
                <span className="row">
                  <Button compact variant="ghost" onClick={() => setCurrent(run)}>
                    Show
                  </Button>
                  <label className="check small">
                    <input
                      type="checkbox"
                      checked={compare.includes(run.id)}
                      onChange={(event) => setCompare((list) => (event.target.checked ? [...list, run.id].slice(-4) : list.filter((id) => id !== run.id)))}
                    />
                    Compare
                  </label>
                </span>
              )}
            />
            {compared.length > 1 ? (
              <DataTable
                mode="scroll"
                caption="Comparison"
                rows={[
                  ['Market', (r: SavedRun) => r.report.market],
                  ['Parameters', (r: SavedRun) => r.report.parameters ?? ''],
                  ['Period', (r: SavedRun) => `${fmtTime(r.report.start)} → ${fmtTime(r.report.end)}`],
                  ['Profit / loss', (r: SavedRun) => `${fmtSignedMoney(r.report.profitLoss)} ${fmtSignedPercent(r.report.returnPercent)}`],
                  ['Trades', (r: SavedRun) => `${r.report.trades} (${fmtPercent(r.report.winRate, 1)} won)`],
                  ['Best trade', (r: SavedRun) => fmtSignedMoney(r.report.best)],
                  ['Max drawdown', (r: SavedRun) => `${fmtSignedMoney(r.report.maxDrawdown)} (${fmtPercent(r.report.maxDrawdownPercent)})`],
                ] as [string, (r: SavedRun) => string][]}
                rowKey={(row) => row[0]}
                columns={[
                  { key: 'what', header: '', render: (row) => <strong className="label">{row[0]}</strong> },
                  ...compared.map((run, index) => ({ key: run.id, header: `Run ${index + 1}`, render: (row: [string, (r: SavedRun) => string]) => row[1](run) })),
                ]}
              />
            ) : compare.length === 1 ? (
              <p className="hint">Tick one more run to compare.</p>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No runs yet.">Each backtest you run is kept on this device (the last 50), with its curve if you drew it.</EmptyState>
        )}
      </Section>
    </>
  )
}
