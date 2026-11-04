import { useCommand } from '../api/bot.ts'
import { cmd } from '../api/commands.ts'
import { parseMarketList } from '../api/parse/markets.ts'
import { parseStatus } from '../api/parse/status.ts'
import { parseStrategyCatalog } from '../api/parse/strategies.ts'

/** Stored markets (`market list`); kept on the device for offline starts. */
export const useMarkets = () => useCommand('markets', cmd.marketList(), parseMarketList, { persist: true })

/**
 * The strategy catalog (`strategies --json`: parameters, default rules and rule syntax); it changes only with a
 * new bot version. A bot from before rules has no --json (a usage error), and its printed catalog is read instead.
 */
export const useStrategies = () =>
  useCommand('strategies', cmd.strategies(), parseStrategyCatalog, {
    persist: true,
    staleTime: 10 * 60_000,
    fallback: { args: cmd.strategiesText(), when: (outcome) => outcome.kind === 'usage' },
  })

/** Health check (`status`), which exits 1 with a full answer when the database is down. */
export const useStatus = () => useCommand('status', cmd.status(), parseStatus, { accept: [1], persist: true })
