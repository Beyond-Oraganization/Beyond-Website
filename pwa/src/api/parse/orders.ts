import type { CommandResult } from '../types.ts'
import { findTable, parsed, rowsOf, topLines, unreadable, type Parsed } from './blocks.ts'
import { parseNumber, parseTime } from './format.ts'

export type OrderRow = {
  id: string
  symbol: string
  side: 'Buy' | 'Sell' | 'None' | string
  quantity: number | null
  price: number | null
  /** "open" (filled position), "closed", or the status name: New, PartiallyFilled, Canceled, Rejected. */
  status: string
  type: string
  created: number | null
}

/** `orders list [--broker]`: table Id, Symbol, Side, Quantity, Price, Status, Type, Created (UTC). */
export function parseOrders(result: CommandResult): Parsed<OrderRow[]> {
  const table = findTable(result.blocks, ['Id', 'Symbol', 'Side', 'Quantity'])
  if (!table) {
    const empty = topLines(result.blocks).some((line) => line.startsWith('No orders recorded') || line.startsWith('The broker has no open positions'))
    return empty ? parsed([]) : unreadable('No order table in the answer.')
  }
  return parsed(
    rowsOf(table).map((row) => ({
      id: row.Id ?? '',
      symbol: row.Symbol ?? '',
      side: row.Side ?? '',
      quantity: parseNumber(row.Quantity),
      price: parseNumber(row.Price),
      status: row.Status ?? '',
      type: row.Type ?? '',
      created: parseTime(row['Created (UTC)']),
    })),
  )
}

/** "Filled: Buy 1 XAUUSD @ 2,650.12 (id 123)." */
export function readFill(line: string): { side: string; quantity: number | null; symbol: string; price: number | null; id: string } | null {
  const match = /^Filled: (\w+) (\S+) (\S+) @ (\S+) \(id ([^)]+)\)\.?$/.exec(line.trim())
  return match ? { side: match[1]!, quantity: parseNumber(match[2]), symbol: match[3]!, price: parseNumber(match[4]), id: match[5]! } : null
}
