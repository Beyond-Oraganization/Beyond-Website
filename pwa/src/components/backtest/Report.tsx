import type { ReactNode } from 'react'
import { figuresOf } from '../../backtest/figures.ts'
import { METHOD_NAMES, type KeptScenarios, type SavedRun } from '../../backtest/runs.ts'
import { fmtCount, fmtMoney, fmtPercent, fmtSignedPercent } from '../../format.ts'
import { useSettings } from '../../state/settings.ts'
import { DataTable } from '../DataTable.tsx'
import { Callout, Figure } from '../ui.tsx'
import { MonteCarloChart } from './MonteCarloChart.tsx'
import { PricePathsChart } from './PricePathsChart.tsx'

/** A panel that starts closed and stays the way it was left, on this device. */
export function Remembered({ name, summary, children }: { name: string; summary: string; children: ReactNode }) {
  const open = useSettings((state) => state.openPanels[name] ?? false)
  const change = useSettings((state) => state.change)
  return (
    <details
      className="more-box"
      open={open}
      onToggle={(event) => {
        const now = (event.currentTarget as HTMLDetailsElement).open
        if (now !== open) void change({ openPanels: { ...useSettings.getState().openPanels, [name]: now } })
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  )
}

/** Four figures always on screen; every other number grouped in one table that starts closed. */
export function ReportFigures({ run }: { run: SavedRun }) {
  const { headline, groups } = figuresOf(run)
  return (
    <div className="stack">
      <div className="figures">
        {headline.map((figure) => (
          <Figure key={figure.label} label={figure.label} value={figure.value} sub={figure.sub} tone={figure.tone} />
        ))}
      </div>
      <Remembered name="backtest-figures" summary="All figures">
        <div className="stack">
          {groups.map((group) => (
            <div key={group.title} className="stack-sm">
              <h3 className="label mute">{group.title}</h3>
              <dl className="review">
                {group.rows.map(([label, value]) => (
                  <div key={label} style={{ display: 'contents' }}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Remembered>
    </div>
  )
}

/** How the scenarios were made, in a line. */
function madeBy(mc: KeptScenarios): string {
  if (mc.method === 'Bootstrap')
    return `Made by the bootstrap: real candle moves of this market, glued in blocks of about ${fmtCount(mc.meanBlockLength)} candles taken from random places.`
  const drift = (mc.drift ?? 0) * 100
  return `Made by Brownian motion: a random walk with the real drift (${drift > 0 ? '+' : ''}${drift.toFixed(4)}%) and volatility (${fmtPercent((mc.volatility ?? 0) * 100, 3)}) per candle.`
}

/**
 * The Monte Carlo of a device backtest: the strategy backtested again on alternative price histories of the same
 * dates. Every scenario's balance over time with the average and the real history's, where they ended, the share
 * above the starting balance and the real history's rank, the percentiles (closed until opened), a few of the price
 * paths, and what the method cannot see.
 */
export function MonteCarloSection({ mc }: { mc: KeptScenarios }) {
  const { summary } = mc
  const paths = mc.details?.paths ?? null
  return (
    <div className="stack">
      <p className="p">
        The strategy was backtested again, exactly as above, on {fmtCount(summary.scenarios)} alternative price histories of the same dates. {madeBy(mc)}
      </p>
      <MonteCarloChart start={summary.initialBalance} times={mc.times} meanPath={summary.meanPath} paths={paths} finals={mc.finals} meanFinal={summary.meanFinal} real={mc.real} />
      {paths ? null : <p className="hint">This browser keeps where the scenarios ended, not their paths: run it again to see them. The desktop app keeps everything.</p>}
      <div className="big-figure">
        <span className="value">{fmtPercent(summary.endedAboveStartPercent, 1)}</span>
        <span className="p">
          of {fmtCount(summary.scenarios)} alternative pasts ended above the starting balance of {fmtMoney(summary.initialBalance)} ({fmtCount(summary.endedAboveStart)} of them).
        </span>
      </div>
      <p className="p">
        <strong>The real history beat {fmtPercent(summary.realBeatPercent, 0)} of them.</strong> A strategy that ranks near the top only on the real history was probably
        fitted to it; one that ranks in the middle is not proven either.
      </p>
      <div className="figures">
        <Figure label="Mean final balance" value={fmtMoney(summary.meanFinal)} sub={fmtSignedPercent(((summary.meanFinal - summary.initialBalance) / summary.initialBalance) * 100)} />
        <Figure label="Median final balance" value={fmtMoney(summary.medianFinal)} sub="half the scenarios ended below it" />
        <Figure label="Real history" value={`beat ${fmtPercent(summary.realBeatPercent, 0)}`} sub="of the alternative pasts" />
      </div>
      <Remembered name="backtest-percentiles" summary="Percentiles">
        <div className="stack-sm">
          <p className="hint">
            Each column is sorted on its own, so a row is not one scenario. At 5%, 5 of every 100 scenarios ended lower and fell deeper; at 95%, 95 of 100 did.
          </p>
          <DataTable
            mode="scroll"
            caption="Monte Carlo percentiles"
            rows={summary.percentiles}
            rowKey={(row) => String(row.percentile)}
            columns={[
              { key: 'p', header: 'Percentile', render: (row) => `${row.percentile}%` },
              { key: 'final', header: 'Final balance', align: 'right', render: (row) => fmtMoney(row.finalBalance) },
              { key: 'return', header: 'Return', align: 'right', render: (row) => fmtSignedPercent(row.returnPercent) },
              { key: 'dd', header: 'Max drawdown', align: 'right', render: (row) => fmtPercent(row.maxDrawdownPercent) },
            ]}
          />
          <p className="foot">
            {fmtCount(summary.scenarios)} alternative histories by {METHOD_NAMES[mc.method]} · seed {mc.seed}
          </p>
        </div>
      </Remembered>
      <div className="stack-sm">
        <h3 className="h3">Alternative price paths</h3>
        <p className="hint">{mc.details ? `${mc.details.prices.length} of the alternative histories` : 'The alternative histories'}, around the real price they were made from.</p>
        <PricePathsChart times={mc.priceTimes} real={mc.realPrices} paths={mc.details?.prices ?? null} />
      </div>
      <Callout label="What a Monte Carlo leaves out">
        {mc.method === 'Bootstrap' ? (
          <p>
            Every candle is a move this market really made, but the blocks are glued at random: trends and regimes longer than a block are broken up, and a weekend gap can land
            mid-week. Fees and spread are left out, as in the backtest.
          </p>
        ) : (
          <p>
            Brownian motion is calmer than any real market: no fat tails, no calm and wild spells, no gaps. Read it as a baseline beside the bootstrap: a strategy that does better
            on the bootstrap leans on structure the real market has. Fees and spread are left out, as in the backtest.
          </p>
        )}
      </Callout>
    </div>
  )
}
