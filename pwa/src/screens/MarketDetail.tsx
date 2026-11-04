import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAction, useCommand } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import { parseInterval } from '../api/intervals.ts'
import { parseCandles, parseIndicators, parseOldestCandle, type Indicators } from '../api/parse/markets.ts'
import { parseSignal, type SignalReading } from '../api/parse/strategies.ts'
import type { CommandResult } from '../api/types.ts'
import { Answer, FailurePanel, RawAnswer } from '../components/Answer.tsx'
import { Chart, type ChartLine } from '../components/Chart.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { Decision } from '../components/Decision.tsx'
import { Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { Button, ButtonLink, Callout, Section } from '../components/ui.tsx'
import { fmtNumber, fmtPrice, fmtTime } from '../format.ts'
import { useStrategies } from '../hooks/data.ts'
import { useMemoryWarning } from '../hooks/memory.ts'
import { envelope, warmupFor } from '../indicators.ts'
import { useSettings } from '../state/settings.ts'

const COUNTS = [50, 200, 500, 1000, 2000]

export default function MarketDetail() {
  const { symbol = '', interval = '' } = useParams()
  const market = `${symbol} ${interval}`
  const info = parseInterval(interval)
  const { candles: count, change } = useSettings()
  const strategies = useStrategies()
  const drcs = strategies.data?.parsed.ok ? strategies.data.parsed.value.find((d) => d.name === 'drcs') : undefined
  const defaults = Object.fromEntries((drcs?.parameters ?? []).map((p) => [p.name, p.default]))
  const [depth, setDepth] = useState<number>(defaults.depth ?? 23)
  const deviation = defaults.deviation ?? 1
  const lines = defaults['moving-count'] ?? 2
  const run = useAction()
  const warning = useMemoryWarning(market)

  // The chart's candles, with enough earlier ones for the averages to settle (see indicators.ts).
  const query = useCommand('candles', cmd.candlesShow(symbol, interval, { last: count + warmupFor(depth) }), parseCandles)
  const all = useMemo(() => (query.data?.parsed.ok ? query.data.parsed.value : []), [query.data])
  const shown = useMemo(() => all.slice(-count), [all, count])
  const chartLines = useMemo<ChartLine[]>(() => {
    if (!all.length) return []
    const { center, bands } = envelope(all, depth, deviation, lines, count)
    return [{ name: `EMA(${depth})`, points: center }, ...bands.map((band) => ({ name: band.name, points: band.values, dashed: true }))]
  }, [all, depth, deviation, lines, count])

  const [signal, setSignal] = useState<SignalReading | null>(null)
  const [signalFailure, setSignalFailure] = useState<CommandFailure | null>(null)
  const [signalBusy, setSignalBusy] = useState(false)
  const [oldest, setOldest] = useState<string | null>(null)
  const [botIndicators, setBotIndicators] = useState<{ value: Indicators | null; result: CommandResult } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const askSignal = async () => {
    setSignalBusy(true)
    setSignalFailure(null)
    try {
      const reading = parseSignal(await run(cmd.signal({ strategy: 'drcs', symbol, interval, params: { ...defaults, depth } })))
      setSignal(reading.ok ? reading.value : null)
    } catch (error) {
      setSignalFailure(error as CommandFailure)
    } finally {
      setSignalBusy(false)
    }
  }

  return (
    <>
      <ScreenHead
        kicker={info ? `Every ${info.code}` : 'Market'}
        title={market}
        crumbs={[{ label: 'Markets', to: '/markets' }, { label: market }]}
        actions={
          <>
            <ButtonLink to={`/backtest?market=${encodeURIComponent(market)}`} variant="ghost" icon="backtest">
              Backtest
            </ButtonLink>
            <ButtonLink to={`/trading?start=${encodeURIComponent(market)}`} icon="play">
              Trade it
            </ButtonLink>
          </>
        }
      />
      <Section variant="alt" label="Chart">
        <div className="spread" style={{ marginBottom: 16 }}>
          <Segmented name="count" legend="Candles" value={String(count)} onChange={(value) => void change({ candles: Number(value) })} options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />
          <Segmented name="depth" legend="EMA and ATR depth" value={String(depth)} onChange={(value) => setDepth(Number(value))} options={[...new Set([defaults.depth ?? 23, 50, 100])].map((n) => ({ value: String(n), label: String(n) }))} />
        </div>
        <Answer query={query} lines={6}>
          {(value) =>
            value.length ? (
              <div className="stack-sm">
                <Chart candles={shown} lines={chartLines} label={`${market}: ${shown.length} candles from ${fmtTime(shown[0]?.time)} to ${fmtTime(shown.at(-1)?.time)} UTC, last close ${fmtPrice(shown.at(-1)?.close)}`} />
                <p className="chart-legend">
                  <span>
                    <i /> EMA({depth})
                  </span>
                  <span>
                    <i className="dash" /> Bands: EMA ± ATR × {deviation} × 1…{lines}, the Double Red Cross envelope
                  </span>
                </p>
                <p className="hint">Bands are worked out on this device from the bot’s candles with the bot’s formulas, so the chart does not load the market into the bot’s memory.</p>
              </div>
            ) : (
              <Callout label="No candles">
                <p>
                  {market} has no stored candles. <Link className="underline" to={`/markets?add=${symbol}&interval=${encodeURIComponent(interval)}`}>Add it</Link> to download them.
                </p>
              </Callout>
            )
          }
        </Answer>
      </Section>
      <Section label="Decision now">
        <div className="cols2">
          <div className="stack">
            <h2 className="h2">What drcs decides now</h2>
            <p className="p">The decision on the newest closed candle, with the values behind it. It syncs first and never trades. It needs the bot to be signed in.</p>
            {warning ? (
              <Callout label="Memory" tone="warn">
                <p>{warning}</p>
              </Callout>
            ) : null}
            <div className="btn-row">
              <Button busy={signalBusy} onClick={() => void askSignal()}>
                Ask for the signal
              </Button>
            </div>
            {signalFailure ? <FailurePanel failure={signalFailure} /> : null}
          </div>
          <div>{signal ? <Decision reading={signal} /> : null}</div>
        </div>
      </Section>
      <Section variant="alt" label="Data">
        <div className="stack">
          <h2 className="h2">Data</h2>
          <div className="btn-row">
            <Button
              variant="ghost"
              busy={busy === 'oldest'}
              onClick={async () => {
                setBusy('oldest')
                try {
                  const reading = parseOldestCandle(await run(cmd.candlesOldest(symbol, interval)))
                  setOldest(reading.ok ? `${reading.value.broker}’s oldest ${market} candle opened ${fmtTime(reading.value.time)} UTC (close ${fmtPrice(reading.value.close)}).` : 'The answer could not be read.')
                } catch (error) {
                  setOldest((error as Error).message)
                } finally {
                  setBusy(null)
                }
              }}
            >
              The broker’s oldest candle
            </Button>
            <Button
              variant="ghost"
              busy={busy === 'indicators'}
              onClick={async () => {
                setBusy('indicators')
                try {
                  const result = await run(cmd.indicatorsShow(symbol, interval, { depth, last: 20 }))
                  const reading = parseIndicators(result)
                  setBotIndicators({ value: reading.ok ? reading.value : null, result })
                } catch (error) {
                  setOldest((error as Error).message)
                } finally {
                  setBusy(null)
                }
              }}
            >
              The bot’s indicator values
            </Button>
          </div>
          {warning && !botIndicators ? <p className="hint">The bot’s indicator values load the market into its memory. {warning}</p> : null}
          {oldest ? <Callout>{oldest}</Callout> : null}
          {botIndicators?.value ? (
            <DataTable
              mode="scroll"
              caption="The bot's indicators"
              rows={[...botIndicators.value.rows].reverse()}
              rowKey={(row) => String(row.time)}
              columns={[
                { key: 'time', header: 'Open (UTC)', render: (row) => fmtTime(row.time) },
                { key: 'close', header: 'Close', align: 'right', render: (row) => fmtPrice(row.close) },
                { key: 'ema', header: `EMA(${botIndicators.value.depth})`, align: 'right', render: (row) => fmtPrice(row.ema) },
                { key: 'rma', header: `RMA(${botIndicators.value.depth})`, align: 'right', render: (row) => fmtPrice(row.rma) },
                { key: 'atr', header: `ATR(${botIndicators.value.depth})`, align: 'right', render: (row) => fmtPrice(row.atr) },
                { key: 'lower', header: 'EMA − ATR', align: 'right', render: (row) => fmtPrice(row.lower) },
                { key: 'upper', header: 'EMA + ATR', align: 'right', render: (row) => fmtPrice(row.upper) },
              ]}
            />
          ) : null}
          {botIndicators && !botIndicators.value ? <RawAnswer result={botIndicators.result} /> : null}
          <details className="more-box">
            <summary>The candles as a table</summary>
            <DataTable
              mode="scroll"
              maxHeight
              caption="Candles"
              rows={[...shown].reverse()}
              rowKey={(row) => String(row.time)}
              columns={[
                { key: 'time', header: 'Open (UTC)', render: (row) => fmtTime(row.time) },
                { key: 'open', header: 'Open', align: 'right', render: (row) => fmtPrice(row.open) },
                { key: 'high', header: 'High', align: 'right', render: (row) => fmtPrice(row.high) },
                { key: 'low', header: 'Low', align: 'right', render: (row) => fmtPrice(row.low) },
                { key: 'close', header: 'Close', align: 'right', render: (row) => <span className={row.close >= row.open ? 'gain' : 'loss'}>{fmtPrice(row.close)}</span> },
                { key: 'volume', header: 'Volume', align: 'right', render: (row) => fmtNumber(row.volume) },
              ]}
            />
          </details>
        </div>
      </Section>
    </>
  )
}
