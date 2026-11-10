import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { createEngine, engineVersion, type Engine } from './engine.ts'

let shared: Engine | null = null

/** The app's one engine, its worker started on the first backtest. Tests provide a fake through the context. */
export const EngineContext = createContext<() => Engine>(() => (shared ??= createEngine()))

export const useEngine = () => useContext(EngineContext)

/** The version the engine on this device was built from (`engine/version.json`), read once; null when unknown. */
export function useEngineVersion(): string | null {
  const query = useQuery({ queryKey: ['engine-version'], queryFn: () => engineVersion(), staleTime: Infinity, retry: false })
  return query.data?.version ?? null
}
