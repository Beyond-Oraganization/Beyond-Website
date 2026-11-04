import { useCallback, useEffect, useState } from 'react'
import { db } from '../state/db.ts'
import type { StrategyConfig } from './config.ts'

/**
 * A named strategy setup kept on this device for one bot: the strategy, its parameters and its rules, without a
 * market, so one setup can trade or backtest any market. Applied with `applySetup`, which fits it to the catalog
 * as the bot describes it then.
 */
export type StrategySetup = Pick<StrategyConfig, 'strategy' | 'params' | 'rules'> & { name: string; savedAt: number }

export const MAX_SETUP_NAME = 60
export const setupsKey = (connectionId: string) => `setups:${connectionId}`

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Adds the setup, replacing one of the same name (in any case), sorted by name. */
export function saveSetup(list: StrategySetup[], setup: StrategySetup): StrategySetup[] {
  const named = { ...setup, name: setup.name.trim().slice(0, MAX_SETUP_NAME) }
  return [...list.filter((s) => !sameName(s.name, named.name)), named].sort((a, b) => a.name.localeCompare(b.name))
}

export const removeSetup = (list: StrategySetup[], name: string) => list.filter((s) => !sameName(s.name, name))

export const findSetup = (list: StrategySetup[], name: string) => list.find((s) => sameName(s.name, name)) ?? null

export function useSetups(connectionId: string | undefined) {
  const [setups, setSetups] = useState<StrategySetup[]>([])

  useEffect(() => {
    if (!connectionId) return
    let current = true
    void db.get<StrategySetup[]>(setupsKey(connectionId)).then((saved) => {
      if (current) setSetups(saved ?? [])
    })
    return () => {
      current = false
    }
  }, [connectionId])

  const persist = useCallback(
    (change: (list: StrategySetup[]) => StrategySetup[]) =>
      setSetups((list) => {
        const next = change(list)
        if (connectionId) void db.set(setupsKey(connectionId), next)
        return next
      }),
    [connectionId],
  )

  return {
    setups,
    save: useCallback((setup: StrategySetup) => persist((list) => saveSetup(list, setup)), [persist]),
    remove: useCallback((name: string) => persist((list) => removeSetup(list, name)), [persist]),
  }
}
