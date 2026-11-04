import { Answer } from '../components/Answer.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ButtonLink, Pill, Section } from '../components/ui.tsx'
import { useStrategies } from '../hooks/data.ts'

/** The envelope and the two crossings Double Red Cross acts on, drawn in the website's line style. */
function DrcsDiagram() {
  const y = { u2: 40, u1: 80, c: 120, l1: 160, l2: 200 }
  const candle = (x: number, open: number, close: number, high: number, low: number, up: boolean) => (
    <g>
      <path d={`M${x} ${high}V${low}`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <rect x={x - 11} y={Math.min(open, close)} width="22" height={Math.abs(open - close)} fill={up ? 'var(--gain)' : 'var(--loss)'} stroke="currentColor" strokeWidth="2" />
    </g>
  )
  return (
    <figure className="stack-sm">
      <svg viewBox="0 0 640 250" width="100%" role="img" aria-labelledby="drcs-diagram-title" style={{ maxWidth: 760, color: 'var(--fg)' }}>
        <title id="drcs-diagram-title">
          The EMA with two bands above and below it. A candle that opens below the first lower band and closes above it is a buy; one that opens above it and closes below it closes the newest position.
        </title>
        <g fill="none" stroke="currentColor">
          <path d={`M20 ${y.c}H620`} strokeWidth="3" />
          {[y.u2, y.u1, y.l1, y.l2].map((level) => (
            <path key={level} d={`M20 ${level}H620`} strokeWidth="2" strokeDasharray="8 6" opacity={level === y.l1 ? 1 : 0.55} />
          ))}
        </g>
        <g fontFamily="'IBM Plex Mono', monospace" fontSize="12" fontWeight="700" fill="currentColor">
          <text x="24" y={y.c - 8}>EMA (depth)</text>
          <text x="24" y={y.u1 - 8}>+1 × ATR × deviation</text>
          <text x="24" y={y.l1 - 8}>TRIGGER BAND: −1 × ATR × deviation</text>
          <text x="24" y={y.l2 + 22}>−2 × …</text>
        </g>
        {candle(300, 182, 140, 132, 192, true)}
        {candle(470, 142, 178, 134, 188, false)}
        <g fontFamily="'IBM Plex Mono', monospace" fontSize="12" fontWeight="700" fill="currentColor" textAnchor="middle">
          <text x="300" y="232">OPENS BELOW, CLOSES ABOVE</text>
          <text x="300" y="248">BUY HALF THE BALANCE</text>
          <text x="470" y="232">OPENS ABOVE, CLOSES BELOW</text>
          <text x="470" y="248">CLOSE THE NEWEST POSITION</text>
        </g>
      </svg>
    </figure>
  )
}

export default function Strategies() {
  const strategies = useStrategies()
  return (
    <>
      <ScreenHead kicker="Strategies" title="What the bot can run." lead="Each strategy is a pure function of the candles: live trading and backtests share the same decision code, so they cannot drift apart." />
      <Section variant="alt" label="Catalog">
        <Answer query={strategies}>
          {(definitions) => (
            <ul className="rows">
              {definitions.map((definition) => {
                const market = definition.defaultMarket ? `${definition.defaultMarket.symbol} ${definition.defaultMarket.interval}` : null
                return (
                  <li key={definition.name} className="g2">
                    <div className="stack-sm">
                      <p className="label mute">Strategy</p>
                      <div className="pills">
                        <Pill tone="solid">{definition.name}</Pill>
                        {market ? <Pill>{market}</Pill> : null}
                      </div>
                    </div>
                    <div className="stack">
                      <h2 className="h2">{definition.title}</h2>
                      <p className="p">{definition.description}</p>
                      <DataTable
                        caption={`${definition.name} parameters`}
                        rows={definition.parameters}
                        rowKey={(p) => p.name}
                        columns={[
                          { key: 'name', header: 'Parameter', card: 'title', render: (p) => <span className="mono">{p.name}</span> },
                          { key: 'default', header: 'Default', card: 'sub', align: 'right', render: (p) => p.default },
                          { key: 'range', header: 'Range', align: 'right', render: (p) => `${p.min}–${p.max}` },
                          { key: 'meaning', header: 'Meaning', wrap: true, render: (p) => p.meaning },
                        ]}
                      />
                      <div className="btn-row">
                        <ButtonLink to={market ? `/backtest?market=${encodeURIComponent(market)}` : '/backtest'} icon="backtest">
                          Backtest it
                        </ButtonLink>
                        <ButtonLink to={market ? `/trading?start=${encodeURIComponent(market)}` : '/trading'} variant="ghost" icon="play">
                          Trade it
                        </ButtonLink>
                        {market ? (
                          <ButtonLink to={`/markets/${definition.defaultMarket!.symbol}/${encodeURIComponent(definition.defaultMarket!.interval)}`} variant="ghost" icon="markets">
                            Its market
                          </ButtonLink>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Answer>
      </Section>
      <Section label="How Double Red Cross decides">
        <div className="stack">
          <h2 className="h2">How Double Red Cross decides</h2>
          <p className="p">
            It builds an adaptive envelope around the EMA: bands spaced ATR × deviation apart, moving-count of them on each side. On each closed candle it looks at one lower band, the trigger (1 = nearest the center).
          </p>
          <DrcsDiagram />
          <ul className="checks">
            <li>
              <span>
                <strong>Buy</strong> with half of the balance when a candle opens below the trigger band and closes above it.
              </span>
            </li>
            <li>
              <span>
                <strong>Close the newest position</strong> when a candle opens above that band and closes below it.
              </span>
            </li>
            <li>
              <span>A candle is acted on at most once; a restart only previews the newest candle and never repeats a trade.</span>
            </li>
            <li>
              <span>Weekend-closed symbols (XAUUSD, XAGUSD, EURUSD, EURPLN…) never trade Saturday and Sunday candles.</span>
            </li>
          </ul>
        </div>
      </Section>
    </>
  )
}
