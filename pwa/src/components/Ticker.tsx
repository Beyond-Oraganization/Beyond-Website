import { Fragment } from 'react'

/**
 * The website's orange ticker band, carrying live figures. It is decorative (aria-hidden): every figure is also
 * on the screen in full. With reduced motion it stands still and wraps.
 */
export function Ticker({ items }: { items: string[] }) {
  if (!items.length) return null
  const group = (hidden: boolean) => (
    <div className="ticker-group" aria-hidden={hidden || undefined}>
      {items.map((item, index) => (
        <Fragment key={index}>
          <span>{item}</span>
          <i />
        </Fragment>
      ))}
    </div>
  )
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {group(false)}
        {group(true)}
      </div>
    </div>
  )
}
