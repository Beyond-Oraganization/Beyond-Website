import type { ReactNode } from 'react'
import { figuresOf } from '../../backtest/figures.ts'
import { pathByTrade, type DeviceResult, type SavedRun } from '../../backtest/runs.ts'
import { fmtCount, fmtMoney, fmtPercent, fmtSignedPercent } from '../../format.ts'
import { useSettings } from '../../state/settings.ts'
import { DataTable } from '../DataTable.tsx'
import { Callout, Figure } from '../ui.tsx'
import { MonteCarloChart } from './MonteCarloChart.tsx'

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

/**
 * The Monte Carlo of a device backtest: every path with the average one and where they ended, the share that ended
 * above the starting balance, the percentiles (closed until opened), and what the simulation cannot see.
 */
export function MonteCarloSection({ result }: { result: DeviceResult }) {
  const mc = result.monteCarlo
  if (!mc) return result.monteCarloSkipped ? <p className="p">{result.monteCarloSkipped}</p> : null
  return (
    <div className="stack">
      <MonteCarloChart
        start={mc.initialBalance}
        pointTrades={mc.pointTrades}
        meanPath={mc.meanPath}
        pathPoints={mc.pathPoints}
        finals={mc.finals}
        meanFinal={mc.meanFinal}
        backtest={pathByTrade(result)}
      />
      {mc.pathPoints ? null : <p className="hint">Saved runs keep where the paths ended, not the paths themselves: run it again to see them.</p>}
      <div className="big-figure">
        <span className="value">{fmtPercent(mc.endedAboveStartPercent, 1)}</span>
        <span className="p">
          of {fmtCount(mc.paths)} paths ended above the starting balance of {fmtMoney(mc.initialBalance)} ({fmtCount(mc.endedAboveStart)} of them).
        </span>
      </div>
      <div className="figures">
        <Figure label="Mean final balance" value={fmtMoney(mc.meanFinal)} sub={fmtSignedPercent(((mc.meanFinal - mc.initialBalance) / mc.initialBalance) * 100)} />
        <Figure label="Median final balance" value={fmtMoney(mc.medianFinal)} sub="half the paths ended below it" />
        <Figure label="Ruined" value={fmtCount(mc.ruined)} sub={mc.ruined ? 'paths whose balance reached 0' : 'no path reached 0'} tone={mc.ruined ? 'loss' : null} />
      </div>
      {mc.warnings.length ? (
        <Callout label="Read with care" tone="warn">
          {mc.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </Callout>
      ) : null}
      <Remembered name="backtest-percentiles" summary="Percentiles">
        <div className="stack-sm">
          <p className="hint">
            Each column is sorted on its own, so a row is not one path. At 5%, 5 of every 100 paths ended lower and fell deeper; at 95%, 95 of 100 did.
          </p>
          <DataTable
            mode="scroll"
            caption="Monte Carlo percentiles"
            rows={mc.percentiles}
            rowKey={(row) => String(row.percentile)}
            columns={[
              { key: 'p', header: 'Percentile', render: (row) => `${row.percentile}%` },
              { key: 'final', header: 'Final balance', align: 'right', render: (row) => fmtMoney(row.finalBalance) },
              { key: 'return', header: 'Return', align: 'right', render: (row) => fmtSignedPercent(row.returnPercent) },
              { key: 'dd', header: 'Max drawdown', align: 'right', render: (row) => fmtPercent(row.maxDrawdownPercent) },
            ]}
          />
          <p className="foot">
            {fmtCount(mc.paths)} paths of {fmtCount(mc.tradesPerPath)} trades, drawn with replacement from this backtest’s trades · seed {mc.seed}
          </p>
        </div>
      </Remembered>
      <Callout label="What a Monte Carlo leaves out">
        <p>
          It only reuses this backtest’s own trades, each drawn as if it did not depend on the one before. Real losses tend to come in streaks, so the bad paths can be worse than
          these; and it cannot tell whether the rules were fitted to the past. Fees and spread are left out, as in the backtest.
        </p>
      </Callout>
    </div>
  )
}
