import { Answer } from '../components/Answer.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ButtonLink, Pill, Section } from '../components/ui.tsx'
import { useStrategies } from '../hooks/data.ts'

/** Double Red Cross's envelope and its two default rules, drawn in the website's line style. */
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
          The EMA with two bands above it (upper 1 and upper 2) and two below it (lower 1 and lower 2). A candle that opens below lower 1 and closes above it fires the default open long rule; one that opens above it and closes below it fires the default close long rule.
        </title>
        <g fill="none" stroke="currentColor">
          <path d={`M20 ${y.c}H620`} strokeWidth="3" />
          {[y.u2, y.u1, y.l1, y.l2].map((level) => (
            <path key={level} d={`M20 ${level}H620`} strokeWidth="2" strokeDasharray="8 6" opacity={level === y.l1 ? 1 : 0.55} />
          ))}
        </g>
        <g fontFamily="'IBM Plex Mono', monospace" fontSize="12" fontWeight="700" fill="currentColor">
          <text x="24" y={y.c - 8}>EMA (depth)</text>
          <text x="24" y={y.u2 - 8}>UPPER 2</text>
          <text x="24" y={y.u1 - 8}>UPPER 1: +1 × ATR × deviation</text>
          <text x="24" y={y.l1 - 8}>LOWER 1: −1 × ATR × deviation</text>
          <text x="24" y={y.l2 + 22}>LOWER 2</text>
        </g>
        {candle(300, 182, 140, 132, 192, true)}
        {candle(470, 142, 178, 134, 188, false)}
        <g fontFamily="'IBM Plex Mono', monospace" fontSize="12" fontWeight="700" fill="currentColor" textAnchor="middle">
          <text x="300" y="232">CROSS UP LOWER 1</text>
          <text x="300" y="248">OPEN LONG</text>
          <text x="470" y="232">CROSS DOWN LOWER 1</text>
          <text x="470" y="248">CLOSE LONG</text>
        </g>
      </svg>
    </figure>
  )
}

export default function Strategies() {
  const strategies = useStrategies()
  // The diagram draws Double Red Cross's own default rules, so it shows only for a bot that has them.
  const showsDrcs = strategies.data?.parsed.ok === true && strategies.data.parsed.value.some((d) => d.name === 'drcs' && d.rules)
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
                      {definition.rules ? (
                        <div className="stack-sm">
                          <p className="label mute">Default rules, tried in order</p>
                          <ol className="rule-list mono">
                            {definition.rules.defaults.map((rule) => (
                              <li key={rule}>{rule}</li>
                            ))}
                          </ol>
                          <p className="hint">
                            Write others as <code className="mono">{definition.rules.syntax}</code>; the Trading and Backtest forms build them for you.
                          </p>
                        </div>
                      ) : null}
                      <div className="btn-row">
                        <ButtonLink to={`/backtest?strategy=${encodeURIComponent(definition.name)}${market ? `&market=${encodeURIComponent(market)}` : ''}`} icon="backtest">
                          Backtest it
                        </ButtonLink>
                        <ButtonLink to={`/trading?strategy=${encodeURIComponent(definition.name)}${market ? `&start=${encodeURIComponent(market)}` : ''}`} variant="ghost" icon="play">
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
      <Section label="How rules decide">
        <div className="stack">
          <h2 className="h2">How rules decide</h2>
          <p className="p">
            A strategy computes its values (an envelope of bands, an average…) and trades by rules. Each rule says what to do when its condition holds on a closed candle:{' '}
            <code className="mono">open long on cross up lower 1</code>.
          </p>
          <ul className="checks">
            <li>
              <span>
                <strong>Open or close, long or short.</strong> An open spends the strategy’s share of the balance; a close closes the newest open position on that side.
              </span>
            </li>
            <li>
              <span>
                <strong>Tried in order.</strong> On each closed candle the first rule whose condition holds gives the signal; if none holds, nothing happens.
              </span>
            </li>
            <li>
              <span>Replace a strategy’s rules in the Trading and Backtest forms. Live trading and backtests run the same rules, so they cannot drift apart.</span>
            </li>
            <li>
              <span>A candle is acted on at most once; a restart only previews the newest candle and never repeats a trade.</span>
            </li>
            <li>
              <span>Weekend-closed symbols (XAUUSD, XAGUSD, EURUSD, EURPLN…) never trade Saturday and Sunday candles.</span>
            </li>
          </ul>
          {showsDrcs ? (
            <div className="stack-sm">
              <h3 className="h3">Example: Double Red Cross’s default rules</h3>
              <DrcsDiagram />
            </div>
          ) : null}
        </div>
      </Section>
    </>
  )
}
