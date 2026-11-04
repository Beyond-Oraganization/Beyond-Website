import type { OutputBlock } from '../api/types.ts'

/**
 * Shows any answer exactly as the bot structured it: text as mono lines, tables as tables, grids as label and
 * value lists, titled panels as boxes. Every screen falls back to this when its own reading of the answer fails,
 * and the Console uses it for everything.
 */
export function BlockView({ blocks }: { blocks: OutputBlock[] }) {
  return (
    <div className="blocks">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: OutputBlock }) {
  switch (block.type) {
    case 'text':
      return <pre className="block-text">{block.text}</pre>
    case 'grid':
      return (
        <dl className="dl">
          {block.rows.map((row, index) => (
            <div key={index} style={{ display: 'contents' }}>
              <dt>{row[0] ?? ''}</dt>
              <dd>{row.slice(1).join(' ')}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return (
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl">
            {block.title ? <caption>{block.title}</caption> : null}
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th key={index} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'section':
      return (
        <section className="block-section">
          <h3 className="block-title">{block.title}</h3>
          <BlockView blocks={block.blocks} />
        </section>
      )
  }
}
