import { useEffect, useId, useRef, useState } from 'react'
import { queryClient, useBot } from '../api/bot.ts'
import { answered, explain, type Outcome } from '../api/client.ts'
import { isDestructive } from '../api/commands.ts'
import { describe, normalize, refusal, splitCommandLine } from '../api/refusal.ts'
import { db } from '../state/db.ts'
import { fmtClock, fmtElapsed } from '../format.ts'
import { BlockView } from './BlockView.tsx'
import { FailurePanel } from './Answer.tsx'
import { ConfirmSheet } from './Sheet.tsx'
import { toast } from './Toasts.tsx'
import { Button, Pill } from './ui.tsx'

/** Every command, for the suggestions list (Cli/CommandLine.cs). */
export const KNOWN_COMMANDS = [
  'help', 'status', 'session', 'session --json', 'session account', 'session positions', 'session stats', 'session strategies', 'session system',
  'balance', 'positions', 'market list', 'market add XAUUSD 1h', 'market sync', 'market remove', 'candles show XAUUSD 1h --last 20',
  'candles oldest XAUUSD 1h', 'indicators show XAUUSD 1h', 'strategies', 'signal drcs -d', 'backtest drcs -d', 'trading status',
  'trading start drcs -d', 'trading stop', 'orders list', 'orders list --broker', 'orders place XAUUSD buy 1', 'orders close',
  'orders clear', 'login', 'logout', 'register', 'credentials', 'market --help', 'trading --help', 'orders --help',
]

type Entry = { id: number; command: string; at: number; outcome: Outcome }
let nextId = 1

const READS = /^(help|--help|status|session|balance|positions|market list|candles|indicators|strategies|signal|backtest|trading status|orders list)\b/

/**
 * Runs any command, as the TUI's ":" command bar does, and shows its answer as the bot structured it.
 * Refused commands never leave the device; anything that changes the bot or the broker is confirmed first;
 * the history keeps commands with their secrets hidden.
 */
export function CommandRunner({ autoFocus, limit = 30 }: { autoFocus?: boolean; limit?: number }) {
  const { connection, queue } = useBot()
  const inputId = useId()
  const [line, setLine] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string[] | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (connection) void db.get<string[]>(`console:${connection.id}`).then((saved) => setHistory(saved ?? []))
  }, [connection])

  const send = async (argv: string[]) => {
    if (!queue || !connection) return
    setBusy(true)
    const typed = describe(argv)
    const nextHistory = [...history.filter((h) => h !== typed), typed].slice(-100)
    setHistory(nextHistory)
    void db.set(`console:${connection.id}`, nextHistory)
    try {
      const outcome = await queue.run(argv, { priority: 'interactive', share: false })
      setEntries((list) => [{ id: nextId++, command: answered(outcome) ? outcome.result.command || typed : typed, at: Date.now(), outcome }, ...list].slice(0, limit))
      if (!READS.test(argv.join(' '))) void queryClient.invalidateQueries({ queryKey: ['bot', connection.id] })
    } finally {
      setBusy(false)
      setLine('')
      setCursor(-1)
      input.current?.focus()
    }
  }

  const submit = () => {
    const argv = normalize(splitCommandLine(line))
    const refused = refusal(argv)
    if (refused) {
      setEntries((list) => [{ id: nextId++, command: describe(argv), at: Date.now(), outcome: { kind: 'usage', roundTripMs: 0, result: { command: describe(argv), exitCode: 2, ok: false, elapsedMs: 0, output: '', blocks: [], error: refused, json: null } } }, ...list])
      return
    }
    if (isDestructive(argv)) setPending(argv)
    else void send(argv)
  }

  return (
    <div className="stack">
      <form
        className="console-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (line.trim()) submit()
        }}
      >
        <div className="field">
          <label htmlFor={inputId}>Command</label>
          <input
            ref={input}
            id={inputId}
            className="mono"
            list={`${inputId}-known`}
            value={line}
            placeholder="market list"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus}
            onChange={(event) => setLine(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' && history.length) {
                event.preventDefault()
                const next = Math.min(history.length - 1, cursor + 1)
                setCursor(next)
                setLine(history[history.length - 1 - next] ?? '')
              } else if (event.key === 'ArrowDown' && cursor >= 0) {
                event.preventDefault()
                const next = cursor - 1
                setCursor(next)
                setLine(next < 0 ? '' : (history[history.length - 1 - next] ?? ''))
              }
            }}
          />
          <datalist id={`${inputId}-known`}>
            {KNOWN_COMMANDS.map((command) => (
              <option key={command} value={command} />
            ))}
          </datalist>
        </div>
        <Button type="submit" busy={busy} style={{ alignSelf: 'end' }}>
          Run
        </Button>
      </form>
      <p className="hint">“help” lists the commands; “&lt;command&gt; --help” shows one. ↑ and ↓ go through what you ran (passwords are never kept).</p>
      <div className="console-out" aria-live="polite">
        {entries.map((entry) => (
          <ConsoleEntry key={entry.id} entry={entry} />
        ))}
      </div>
      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Run this command?"
        intro="It changes the bot or the broker."
        review={pending ? [['Command', describe(pending)]] : []}
        confirmLabel="Run it"
        danger
        onConfirm={async () => {
          if (pending) await send(pending)
        }}
      />
    </div>
  )
}

function ConsoleEntry({ entry }: { entry: Entry }) {
  const outcome = entry.outcome
  const result = answered(outcome) ? outcome.result : null
  const failure = outcome.kind === 'ok' ? null : explain(outcome)
  return (
    <section className="console-entry" aria-label={entry.command}>
      <div className="spread">
        <p className="cmd">› {entry.command}</p>
        <div className="row">
          <Pill tone={outcome.kind === 'ok' ? 'solid' : 'accent'}>{result ? `exit ${result.exitCode}` : outcome.kind}</Pill>
          <span className="foot" style={{ margin: 0 }}>
            {result ? fmtElapsed(result.elapsedMs) : ''} · {fmtClock(entry.at)} UTC
          </span>
          {result?.output ? (
            <button
              type="button"
              className="link small"
              onClick={() =>
                void navigator.clipboard
                  .writeText(result.output)
                  .then(() => toast.success('Copied', entry.command))
                  .catch(() => toast.error('Could not copy'))
              }
            >
              Copy
            </button>
          ) : null}
        </div>
      </div>
      {result?.blocks.length ? <BlockView blocks={result.blocks} /> : null}
      {failure && (outcome.kind !== 'failed' || result?.error) ? <FailurePanel failure={failure} /> : null}
    </section>
  )
}
