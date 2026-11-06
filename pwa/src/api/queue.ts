import { runCommand, type Outcome, type Target } from './client.ts'
import { describe, normalize } from './refusal.ts'

/** User actions go first, then what a screen needs, then background polls. */
export type Priority = 'interactive' | 'view' | 'poll'
const RANK: Record<Priority, number> = { interactive: 0, view: 1, poll: 2 }

export type Busy = { command: string; since: number; priority: Priority; waiting: number }

export type Finished = {
  command: string
  priority: Priority
  outcome: Outcome['kind']
  exitCode: number | null
  elapsedMs: number | null
  roundTripMs: number | null
  at: number
  /** The account the command acted on, as the bot said. */
  account: string | null
  /** The connection token a first login answered with. */
  connection: string | null
}

type Job = {
  args: string[]
  account: string | null
  key: string
  priority: Priority
  shared: boolean
  controller: AbortController
  promise: Promise<Outcome>
  resolve: (outcome: Outcome) => void
}

/** `account`: one of this device's accounts on the bot, for this command only (X-BeyondBot-Account). */
type RunOptions = { priority?: Priority; signal?: AbortSignal; share?: boolean; account?: string | null }

/**
 * The bot runs one command at a time, for every client (Api/CommandRunner.cs). This queue does the same on the
 * device, so a user's action never waits behind a pile of polls: it jumps ahead of reads, identical reads are
 * shared, and the screen always knows what the bot is busy with. Nothing here retries a command.
 */
export class CommandQueue {
  private pending: Job[] = []
  private running: Job | null = null
  private runningSince = 0
  private listeners = new Set<() => void>()
  private finishedListeners = new Set<(finished: Finished) => void>()
  private snapshot: Busy | null = null
  private readonly target: () => Target | null

  constructor(target: () => Target | null) {
    this.target = target
  }

  run(args: string[], { priority = 'interactive', signal, share = priority !== 'interactive', account = null }: RunOptions = {}): Promise<Outcome> {
    const argv = normalize(args)
    const key = [account ?? '', ...argv].join('\u0000')
    if (share) {
      const same = [this.running, ...this.pending].find((job) => job && job.shared && job.key === key)
      if (same) {
        // A user waiting for a shared read lifts it up the queue.
        if (RANK[priority] < RANK[same.priority] && same !== this.running) {
          same.priority = priority
          this.sort()
        }
        return same.promise
      }
    }

    let resolve!: (outcome: Outcome) => void
    const promise = new Promise<Outcome>((done) => (resolve = done))
    const job: Job = { args: argv, account, key, priority, shared: share, controller: new AbortController(), promise, resolve }
    if (signal) {
      if (signal.aborted) return Promise.resolve({ kind: 'cancelled' })
      // A shared read keeps going for its other callers.
      if (!share) signal.addEventListener('abort', () => this.cancel(job), { once: true })
    }
    this.pending.push(job)
    this.sort()
    this.pump()
    return promise
  }

  /** Cancels a waiting job, or aborts the running one: the bot then cancels that command (never trading). */
  private cancel(job: Job) {
    const index = this.pending.indexOf(job)
    if (index >= 0) {
      this.pending.splice(index, 1)
      job.resolve({ kind: 'cancelled' })
      this.changed()
    } else if (this.running === job) {
      job.controller.abort()
    }
  }

  private sort() {
    this.pending.sort((a, b) => RANK[a.priority] - RANK[b.priority])
  }

  private async pump() {
    if (this.running) return
    const job = this.pending.shift()
    if (!job) return this.changed()
    this.running = job
    this.runningSince = Date.now()
    this.changed()

    const target = this.target()
    const outcome: Outcome = target
      ? await runCommand(job.account ? { ...target, account: job.account } : target, job.args, { signal: job.controller.signal })
      : { kind: 'unreachable', reason: 'No bot is connected.' }

    job.resolve(outcome)
    const answered = 'result' in outcome ? outcome : null
    const finished: Finished = {
      command: answered?.result.command || describe(job.args),
      priority: job.priority,
      outcome: outcome.kind,
      exitCode: answered ? answered.result.exitCode : null,
      elapsedMs: answered ? answered.result.elapsedMs : null,
      roundTripMs: answered ? Math.round(answered.roundTripMs) : null,
      at: Date.now(),
      account: answered?.result.account ?? null,
      connection: answered?.result.connection ?? null,
    }
    this.finishedListeners.forEach((listener) => listener(finished))
    this.running = null
    void this.pump()
  }

  private changed() {
    this.snapshot = this.running
      ? { command: describe(this.running.args), since: this.runningSince, priority: this.running.priority, waiting: this.pending.length }
      : null
    this.listeners.forEach((listener) => listener())
  }

  /** What the bot is running for this device right now (for the busy indicator). */
  busy = (): Busy | null => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onFinished(listener: (finished: Finished) => void) {
    this.finishedListeners.add(listener)
    return () => this.finishedListeners.delete(listener)
  }

  /** Drops every waiting job (when the connection changes or the app locks). */
  clear() {
    for (const job of this.pending.splice(0)) job.resolve({ kind: 'cancelled' })
    this.running?.controller.abort()
    this.changed()
  }
}
