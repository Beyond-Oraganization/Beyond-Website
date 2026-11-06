import { ExitCode, type CommandResult, type OutputBlock } from './types.ts'
import { bodyBytes, bodyFor, describe, MAX_BODY_BYTES, normalize, refusal } from './refusal.ts'

/**
 * Where a bot answers, the key it wants, and this device's connection to it: the token its first login answered
 * with (Api/ApiConnections.cs), and optionally one of that connection's accounts for this command only.
 */
export type Target = { url: string; key: string; connection?: string | null; account?: string | null }

/** The request headers of a bot connection (Api/CommandApi.cs). */
export const CONNECTION_HEADER = 'X-BeyondBot-Connection'
export const ACCOUNT_HEADER = 'X-BeyondBot-Account'

/** Every way a command can end, so screens never have to inspect HTTP themselves. */
export type Outcome =
  | { kind: 'ok'; result: CommandResult; roundTripMs: number }
  | { kind: 'failed'; result: CommandResult; roundTripMs: number }
  | { kind: 'usage'; result: CommandResult; roundTripMs: number }
  | { kind: 'signedOut'; result: CommandResult; roundTripMs: number }
  /** 403: the device's connection expired (or the bot restarted), or the picked account is not on it. */
  | { kind: 'expired'; result: CommandResult; roundTripMs: number }
  | { kind: 'cancelled' }
  | { kind: 'unauthorized' }
  | { kind: 'tooLarge' }
  | { kind: 'unreachable'; reason: string }
  | { kind: 'badResponse'; status: number; reason: string }

export type Answered = Extract<Outcome, { result: CommandResult }>
export const answered = (outcome: Outcome): outcome is Answered => 'result' in outcome

/** POST / on the bot's address; a path given in the address (behind a proxy) is kept. */
export function endpoint(url: string): string {
  const parsed = new URL(url.trim())
  if (!parsed.pathname) parsed.pathname = '/'
  parsed.hash = ''
  return parsed.toString()
}

function isBlock(value: unknown): value is OutputBlock {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/** Checks the answer's shape; the bot always sends every field (nulls included). */
export function readResult(json: unknown): CommandResult {
  const value = json as Partial<CommandResult> | null
  if (!value || typeof value !== 'object' || typeof value.exitCode !== 'number' || !Array.isArray(value.blocks))
    throw new Error('The answer is not a Beyond Bot command result.')
  return {
    command: String(value.command ?? ''),
    exitCode: value.exitCode,
    ok: value.exitCode === ExitCode.Success,
    elapsedMs: Number(value.elapsedMs ?? 0),
    output: String(value.output ?? ''),
    blocks: value.blocks.filter(isBlock),
    error: value.error ? { message: String(value.error.message ?? ''), hint: value.error.hint ?? null } : null,
    json: value.json ?? null,
    account: typeof value.account === 'string' ? value.account : null,
    connection: typeof value.connection === 'string' ? value.connection : null,
  }
}

const localResult = (args: string[], message: string, hint: string | null): CommandResult => ({
  command: describe(args),
  exitCode: ExitCode.Usage,
  ok: false,
  elapsedMs: 0,
  output: '',
  blocks: [],
  error: { message, hint },
  json: null,
  account: null,
  connection: null,
})

function classify(result: CommandResult, roundTripMs: number): Outcome {
  switch (result.exitCode) {
    case ExitCode.Success:
      return { kind: 'ok', result, roundTripMs }
    case ExitCode.Usage:
      return { kind: 'usage', result, roundTripMs }
    case ExitCode.NotSignedIn:
      return { kind: 'signedOut', result, roundTripMs }
    case ExitCode.Cancelled:
      return { kind: 'cancelled' }
    default:
      return { kind: 'failed', result, roundTripMs }
  }
}

/**
 * Runs one command on the bot. Always sends `{"args": [...]}`, which keeps spaces, quotes and leading dashes
 * intact. Commands the API refuses never leave the device.
 */
export async function runCommand(target: Target, args: string[], options: { signal?: AbortSignal } = {}): Promise<Outcome> {
  const argv = normalize(args)
  const refused = refusal(argv)
  if (refused) return { kind: 'usage', result: localResult(argv, refused.message, refused.hint), roundTripMs: 0 }
  if (bodyBytes(argv) > MAX_BODY_BYTES) return { kind: 'tooLarge' }

  const started = performance.now()
  let response: Response
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${target.key}`, 'Content-Type': 'application/json' }
    if (target.connection) headers[CONNECTION_HEADER] = target.connection
    if (target.account) headers[ACCOUNT_HEADER] = target.account
    response = await fetch(endpoint(target.url), {
      method: 'POST',
      headers,
      body: bodyFor(argv),
      signal: options.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
    })
  } catch (error) {
    if (options.signal?.aborted || (error as Error)?.name === 'AbortError') return { kind: 'cancelled' }
    return { kind: 'unreachable', reason: error instanceof Error ? error.message : String(error) }
  }

  if (response.status === 401) return { kind: 'unauthorized' }
  if (response.status === 413) return { kind: 'tooLarge' }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (options.signal?.aborted) return { kind: 'cancelled' }
    return { kind: 'badResponse', status: response.status, reason: 'The answer is not JSON.' }
  }
  const roundTripMs = performance.now() - started
  if (response.status === 403) {
    try {
      return { kind: 'expired', result: readResult(body), roundTripMs }
    } catch {
      return { kind: 'expired', result: localResult(argv, 'This connection has expired; sign in again.', null), roundTripMs }
    }
  }
  if (response.status !== 200 && response.status !== 400)
    return { kind: 'badResponse', status: response.status, reason: `The bot answered HTTP ${response.status}.` }
  try {
    return classify(readResult(body), roundTripMs)
  } catch (error) {
    return { kind: 'badResponse', status: response.status, reason: (error as Error).message }
  }
}

/** A command that did not succeed, as an Error the screens can show (message + the bot's hint). */
export class CommandFailure extends Error {
  readonly outcome: Outcome
  readonly hint: string | null
  constructor(outcome: Outcome) {
    const { message, hint } = explain(outcome)
    super(message)
    this.name = 'CommandFailure'
    this.outcome = outcome
    this.hint = hint
  }
  get kind() {
    return this.outcome.kind
  }
}

/** Plain-language message and hint for any outcome other than success. */
export function explain(outcome: Outcome): { message: string; hint: string | null } {
  switch (outcome.kind) {
    case 'ok':
      return { message: 'Done.', hint: null }
    case 'failed':
    case 'usage':
    case 'expired':
    case 'signedOut': {
      const error = outcome.result.error
      if (error) return { message: error.message, hint: error.hint }
      const firstLine = outcome.result.blocks.find((block) => block.type === 'text')
      return { message: firstLine && firstLine.type === 'text' ? firstLine.text.split('\n')[0] ?? 'The command failed.' : 'The command failed.', hint: null }
    }
    case 'cancelled':
      return { message: 'Cancelled.', hint: null }
    case 'unauthorized':
      return { message: 'The bot refused the API key.', hint: 'Check the key in Connections: it is the content of /etc/beyondbot/api-key on the server.' }
    case 'tooLarge':
      return { message: 'That command is too long for the API (4,096 bytes at most).', hint: null }
    case 'unreachable':
      return {
        message: 'The bot cannot be reached.',
        hint: 'Check the address, that this device trusts the bot’s certificate, the firewall, and that this page’s address is in BEYONDBOT_API_ORIGINS.',
      }
    case 'badResponse':
      return { message: outcome.reason, hint: 'Is this address a Beyond Bot started with `serve`?' }
  }
}

/** Unwraps a successful answer or throws a CommandFailure (for queries and mutations). */
export function expectOk(outcome: Outcome): CommandResult {
  if (outcome.kind === 'ok') return outcome.result
  throw new CommandFailure(outcome)
}
