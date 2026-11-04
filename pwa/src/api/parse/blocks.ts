import type { CommandResult, GridBlock, OutputBlock, SectionBlock, TableBlock } from '../types.ts'

/** A reading of a command's answer: the value, or why it could not be read (the screen then shows it raw). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }
export const parsed = <T,>(value: T): Parsed<T> => ({ ok: true, value })
export const unreadable = <T,>(reason: string): Parsed<T> => ({ ok: false, reason })

/** Every block, sections included, depth first. */
export function* walk(blocks: OutputBlock[]): Generator<OutputBlock> {
  for (const block of blocks) {
    yield block
    if (block.type === 'section') yield* walk(block.blocks)
  }
}

/** The first table that has all these columns. Columns are matched by header, never by position. */
export function findTable(blocks: OutputBlock[], required: string[]): TableBlock | null {
  for (const block of walk(blocks)) if (block.type === 'table' && required.every((name) => block.columns.includes(name))) return block
  return null
}

/** A table's rows keyed by header. */
export function rowsOf(table: TableBlock): Record<string, string>[] {
  return table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column, (row[index] ?? '').trim()])))
}

export function findSection(blocks: OutputBlock[], match: (title: string) => boolean): SectionBlock | null {
  for (const block of walk(blocks)) if (block.type === 'section' && match(block.title)) return block
  return null
}

export function sections(blocks: OutputBlock[], match: (title: string) => boolean): SectionBlock[] {
  return [...walk(blocks)].filter((block): block is SectionBlock => block.type === 'section' && match(block.title))
}

export function findGrid(blocks: OutputBlock[]): GridBlock | null {
  for (const block of walk(blocks)) if (block.type === 'grid') return block
  return null
}

/** A grid's rows as label → value (the bot's grids are label and value pairs). */
export function gridMap(grid: GridBlock): Map<string, string> {
  return new Map(grid.rows.map((row) => [(row[0] ?? '').trim(), row.slice(1).join(' ').trim()]))
}

/** Every line of text, in order (top level and inside sections). */
export function lines(blocks: OutputBlock[]): string[] {
  return [...walk(blocks)].flatMap((block) => (block.type === 'text' ? block.text.split('\n').map((line) => line.trim()) : [])).filter(Boolean)
}

/** Top-level text lines only, without the text inside panels. */
export const topLines = (blocks: OutputBlock[]) =>
  blocks.flatMap((block) => (block.type === 'text' ? block.text.split('\n').map((line) => line.trim()) : [])).filter(Boolean)

/**
 * What an action printed: "✓ …" results, "⚠ …" warnings, and the other lines. Status lines such as
 * "Connecting to CTrader…" (Spectre's spinner text on a non-interactive console) end in "…" and are dropped.
 */
export function notices(result: CommandResult): { done: string[]; warnings: string[]; other: string[] } {
  const all = lines(result.blocks)
  const done = all.filter((line) => line.startsWith('✓')).map((line) => line.replace(/^✓\s*/, ''))
  const warnings = all.filter((line) => line.startsWith('⚠')).map((line) => line.replace(/^⚠\s*/, ''))
  const other = all.filter((line) => !line.startsWith('✓') && !line.startsWith('⚠') && !line.endsWith('…'))
  return { done, warnings, other }
}
