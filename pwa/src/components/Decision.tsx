import type { SignalReading } from '../api/parse/strategies.ts'
import { fmtPrice, fmtTime } from '../format.ts'
import { Pill } from './ui.tsx'

/** A strategy's decision on the newest candle and the values behind it (the `signal` panel). */
export function Decision({ reading, title }: { reading: SignalReading; title?: string }) {
  const tone = reading.action === 'open' ? 'solid' : reading.action === 'close' ? 'accent' : undefined
  return (
    <div className="box stack-sm">
      <div className="spread">
        <p className="h3">{title ?? `${reading.strategy} on ${reading.market}`}</p>
        <Pill tone={tone}>{reading.signalText}</Pill>
      </div>
      <p className="p">{reading.reason}</p>
      <dl className="dl">
        <dt>Candle</dt>
        <dd>
          {fmtTime(reading.candle.open)} → {fmtTime(reading.candle.close)} UTC
        </dd>
        {reading.values.map((value) => (
          <div key={value.name} style={{ display: 'contents' }}>
            <dt>{value.name}</dt>
            <dd>{fmtPrice(value.value)}</dd>
          </div>
        ))}
        {reading.nextClose ? (
          <>
            <dt>Next close</dt>
            <dd>{reading.nextClose} UTC</dd>
          </>
        ) : null}
      </dl>
      {reading.parameters ? <p className="foot">{reading.parameters}</p> : null}
    </div>
  )
}
