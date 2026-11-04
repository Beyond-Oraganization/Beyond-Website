import type { ReactNode } from 'react'
import { cx } from './ui.tsx'

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'right'
  /** Long text that may wrap inside the table. */
  wrap?: boolean
  /** How the column shows on a phone card: the card's title, its subtitle, a key/value pair, or not at all. */
  card?: 'title' | 'sub' | 'kv' | 'hide'
}

/**
 * The bot's tables in the website's language: a mono caps header strip, 2px rules, numbers right-aligned.
 * Below 700px wide it becomes ruled cards (`mode="cards"`) or scrolls sideways (`mode="scroll"`, for long
 * numeric tables such as candles).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  mode = 'cards',
  actions,
  maxHeight,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  caption?: string
  mode?: 'cards' | 'scroll'
  actions?: (row: T) => ReactNode
  maxHeight?: boolean
}) {
  const titleColumn = columns.find((column) => column.card === 'title') ?? columns[0]
  const subColumn = columns.find((column) => column.card === 'sub')
  const kvColumns = columns.filter((column) => column !== titleColumn && column !== subColumn && column.card !== 'hide')

  return (
    <>
      <div className={cx('tbl-wrap', mode === 'cards' && 'as-cards', maxHeight && 'tbl-scroll')}>
        <table className="tbl">
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cx(column.align === 'right' && 'r')}>
                  {column.header}
                </th>
              ))}
              {actions ? (
                <th scope="col">
                  <span className="vh">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td key={column.key} className={cx(column.align === 'right' && 'r nowrap', column.wrap ? 'wrap-cell' : column.align !== 'right' && 'nowrap')}>
                    {column.render(row)}
                  </td>
                ))}
                {actions ? <td className="nowrap">{actions(row)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mode === 'cards' ? (
        <ul className="cards" aria-label={caption}>
          {rows.map((row, index) => (
            <li key={rowKey(row, index)}>
              <div className="card-head">
                <span className="card-title">{titleColumn?.render(row)}</span>
                {subColumn ? <span className="mono">{subColumn.render(row)}</span> : null}
              </div>
              {kvColumns.length ? (
                <div className="kv">
                  {kvColumns.map((column) => (
                    <div key={column.key}>
                      <span className="k">{column.header}</span>
                      <span className="v">{column.render(row)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {actions ? <div className="card-actions">{actions(row)}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
