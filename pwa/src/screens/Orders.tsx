import { useId, useState } from 'react'
import { useAction, useCommand } from '../api/bot.ts'
import { cmd } from '../api/commands.ts'
import { notices } from '../api/parse/blocks.ts'
import { parseOrders, readFill, type OrderRow } from '../api/parse/orders.ts'
import { Answer } from '../components/Answer.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { describedBy, Field, Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ConfirmSheet } from '../components/Sheet.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, EmptyState, Pill, Section } from '../components/ui.tsx'
import { fmtNumber, fmtPrice, fmtTime } from '../format.ts'
import { useSessionData } from '../hooks/session.ts'

const columns: Column<OrderRow>[] = [
  { key: 'symbol', header: 'Symbol', card: 'title', render: (o) => o.symbol },
  { key: 'side', header: 'Side', card: 'sub', render: (o) => <Pill tone={o.side === 'Buy' ? 'solid' : undefined}>{o.side}</Pill> },
  { key: 'qty', header: 'Quantity', align: 'right', render: (o) => fmtNumber(o.quantity) },
  { key: 'price', header: 'Price', align: 'right', render: (o) => fmtPrice(o.price) },
  { key: 'status', header: 'Status', render: (o) => o.status },
  { key: 'type', header: 'Type', render: (o) => o.type },
  { key: 'created', header: 'Created (UTC)', render: (o) => fmtTime(o.created) },
  { key: 'id', header: 'Id', render: (o) => o.id },
]

function PlaceOrder({ broker }: { broker: string }) {
  const run = useAction()
  const symbolId = useId()
  const qtyId = useId()
  const [symbol, setSymbol] = useState('XAUUSD')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [quantity, setQuantity] = useState('1')
  const [errors, setErrors] = useState<{ symbol?: string; quantity?: string }>({})
  const [reviewing, setReviewing] = useState(false)

  const review = () => {
    const found: typeof errors = {}
    if (!/^[A-Z0-9._-]{2,20}$/.test(symbol.trim().toUpperCase())) found.symbol = 'Enter a symbol, like XAUUSD.'
    if (!(Number(quantity) > 0)) found.quantity = 'The quantity must be above 0.'
    setErrors(found)
    if (!Object.keys(found).length) setReviewing(true)
  }

  return (
    <form
      className="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        review()
      }}
    >
      <div className="form-grid">
        <Field id={symbolId} label="Symbol" error={errors.symbol}>
          <input id={symbolId} className="mono" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} autoComplete="off" spellCheck={false} aria-invalid={errors.symbol ? true : undefined} aria-describedby={describedBy(symbolId, null, errors.symbol)} />
        </Field>
        <Field id={qtyId} label="Quantity" error={errors.quantity} hint="In the broker’s units for this symbol.">
          <input id={qtyId} className="mono" type="number" min="0" step="any" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-invalid={errors.quantity ? true : undefined} aria-describedby={describedBy(qtyId, 'hint', errors.quantity)} />
        </Field>
      </div>
      <Segmented name="side" legend="Side" value={side} onChange={setSide} options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]} />
      <div className="btn-row">
        <Button type="submit">Review the order</Button>
      </div>
      <ConfirmSheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        title={`Place a market ${side.toUpperCase()}?`}
        intro={`The bot sends a market order to ${broker} now. It fills at the market price.`}
        review={[
          ['Order', `market ${side}`],
          ['Symbol', symbol.trim().toUpperCase()],
          ['Quantity', fmtNumber(Number(quantity))],
          ['Account', broker],
        ]}
        confirmLabel={`Place the ${side}`}
        danger={broker.includes('LIVE')}
        onConfirm={async () => {
          const answer = await run(cmd.ordersPlace(symbol.trim().toUpperCase(), side, Number(quantity)), { invalidate: ['orders-broker', 'orders-records'] })
          const line = notices(answer).done[0] ?? ''
          const fill = readFill(line)
          toast.success('Order filled', fill ? `${fill.side} ${fmtNumber(fill.quantity)} ${fill.symbol} @ ${fmtPrice(fill.price)} (id ${fill.id})` : line)
        }}
      />
    </form>
  )
}

export default function Orders() {
  const [view, setView] = useState<'broker' | 'records'>('broker')
  const [filter, setFilter] = useState('')
  const filterId = useId()
  const symbol = filter.trim().toUpperCase() || null
  const brokerQuery = useCommand('orders-broker', cmd.ordersList({ broker: true, symbol }), parseOrders, { enabled: view === 'broker' })
  const recordsQuery = useCommand('orders-records', cmd.ordersList({ symbol }), parseOrders, { enabled: view === 'records' })
  const session = useSessionData()
  const run = useAction()
  const [closing, setClosing] = useState<OrderRow | null>(null)
  const [clearing, setClearing] = useState(false)
  const account = session.data?.parsed.ok ? session.data.parsed.value.account : null
  const broker = account ? `${account.broker} ${account.mode === 'Live' ? 'LIVE' : 'DEMO'}` : 'the broker'
  const query = view === 'broker' ? brokerQuery : recordsQuery

  return (
    <>
      <ScreenHead kicker="Orders" title="Orders and positions." lead="What is open at the broker, and the order records the bot keeps in its database." />
      <Section variant="alt" label="Order lists">
        <div className="spread" style={{ marginBottom: 20 }}>
          <Segmented name="orders-view" legend="Show" value={view} onChange={setView} options={[{ value: 'broker', label: 'At the broker' }, { value: 'records', label: 'Bot records' }]} />
          <Field id={filterId} label="Symbol filter">
            <input id={filterId} className="mono" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="All" autoComplete="off" />
          </Field>
        </div>
        <Answer query={query}>
          {(rows) =>
            rows.length ? (
              <DataTable
                caption={view === 'broker' ? 'Open at the broker' : 'Bot order records'}
                rows={rows}
                rowKey={(o) => `${o.id}-${o.created}`}
                columns={columns}
                actions={
                  view === 'broker'
                    ? (o) => (
                        <Button compact variant="ghost" onClick={() => setClosing(o)}>
                          {o.status === 'open' ? 'Close' : 'Cancel'}
                        </Button>
                      )
                    : undefined
                }
              />
            ) : (
              <EmptyState title={view === 'broker' ? 'Nothing is open at the broker.' : 'No orders recorded.'} />
            )
          }
        </Answer>
        {view === 'records' ? (
          <div className="btn-row" style={{ marginTop: 20 }}>
            <Button variant="ghost" icon="trash" onClick={() => setClearing(true)}>
              Clear the records
            </Button>
          </div>
        ) : null}
      </Section>
      <Section label="Place an order">
        <div className="g2">
          <div className="stack-sm">
            <h2 className="h2">Place a market order</h2>
            <p className="hint">Orders placed here are not counted in the session’s strategy trades; their profit still counts in its realized P/L.</p>
          </div>
          <div>
            {account?.mode === 'Live' ? (
              <Callout label="Live account" tone="warn">
                <p>This bot trades a live account: this order uses real money.</p>
              </Callout>
            ) : null}
            <PlaceOrder broker={broker} />
          </div>
        </div>
      </Section>
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={closing?.status === 'open' ? 'Close this position?' : 'Cancel this order?'}
        review={closing ? [['Id', closing.id], ['Symbol', closing.symbol], ['Side', closing.side], ['Quantity', fmtNumber(closing.quantity)], ['Price', fmtPrice(closing.price)]] : []}
        confirmLabel={closing?.status === 'open' ? 'Close position' : 'Cancel order'}
        danger
        onConfirm={async () => {
          if (!closing) return
          const answer = await run(cmd.ordersClose(closing.id), { invalidate: ['orders-broker', 'orders-records'] })
          toast.success('Done', notices(answer).done[0])
        }}
      />
      <ConfirmSheet
        open={clearing}
        onClose={() => setClearing(false)}
        title="Delete the bot’s order records?"
        intro="This deletes the records in the bot’s database. Nothing changes at the broker."
        typed="DELETE"
        confirmLabel="Delete the records"
        danger
        onConfirm={async () => {
          const answer = await run(cmd.ordersClear(), { invalidate: ['orders-records'] })
          toast.info('Records', notices(answer).done[0] ?? 'There were no records to delete.')
        }}
      />
    </>
  )
}
