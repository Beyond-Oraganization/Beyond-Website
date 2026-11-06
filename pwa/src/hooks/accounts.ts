import { useCommand } from '../api/bot.ts'
import { cmd } from '../api/commands.ts'
import { parseAccounts, type TradingAccount } from '../api/parse/accounts.ts'

/**
 * This device's trading accounts on the bot (`accounts --json`). A bot from before accounts does not know the
 * command: then `legacy` is true and the screens fall back to the one login `status` shows.
 */
export function useAccounts() {
  const query = useCommand('accounts', cmd.accounts(), parseAccounts, { refetchInterval: 30_000 })
  const accounts: TradingAccount[] = query.data?.parsed.ok ? query.data.parsed.value : []
  const legacy = query.error?.kind === 'usage' && /Unknown command 'accounts'/.test(query.error.message)
  return { query, accounts, current: accounts.find((account) => account.current) ?? null, legacy }
}
