import { marketLabel } from '../api/intervals.ts'
import { useSessionData } from './session.ts'

/**
 * Bot 2.0.0 cannot build its session view once two or more markets are in its memory (Session/SystemProbe.cs
 * sorts MarketId, which has no order). Backtests, signals, starting a strategy and the bot's indicator table
 * load a market; this says so before one of them would load a second.
 */
export function useMemoryWarning(market: string | null): string | null {
  const session = useSessionData()
  const snapshot = session.data?.parsed.ok ? session.data.parsed.value : null
  if (!snapshot || !market || snapshot.system.version !== '2.0.0') return null
  const loaded = snapshot.system.markets.map((m) => marketLabel(m.market))
  if (!loaded.length || loaded.includes(market)) return null
  return `This loads ${market} into the bot’s memory, next to ${loaded.join(', ')}. Bot 2.0.0 then cannot show its session view until it restarts (a known bug; trading is not affected).`
}
