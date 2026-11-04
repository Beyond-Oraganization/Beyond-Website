/**
 * Ports of the bot's own argument rules, so the app never sends what the API refuses and never stores a secret:
 * Cli/Arguments.cs (Split, Command) and Api/CommandRunner.cs (Refusal, Describe).
 */
import type { CommandError } from './types.ts'

const TERMINAL_ONLY = new Set(['run', 'serve', 'ui', 'shell', 'exit', 'quit'])
const WATCHABLE = new Set(['session', 'balance', 'positions'])
const SECRET_OPTIONS = ['--password', '--new-password', '--credential']

/** Splits a typed line like the shell: on whitespace; "double quotes" group words. */
export function splitCommandLine(line: string): string[] {
  return [...line.matchAll(/"[^"]*"|[^\s]+/g)].map((match) => match[0].replace(/^"+|"+$/g, '')).filter((value) => value.length > 0)
}

/** `help` and `?` alone stand for `--help`. */
export const normalize = (args: string[]): string[] => (args.length === 1 && (args[0] === 'help' || args[0] === '?') ? ['--help'] : args)

const isWatch = (arg: string) => arg === '-w' || arg === '--watch' || arg.startsWith('--watch=') || arg.startsWith('--watch:')

/** Why the API would refuse these arguments (HTTP 400), or null. */
export function refusal(args: string[]): CommandError | null {
  const first = args[0]
  if (first === undefined) return { message: "Send a command, e.g. 'market list'.", hint: "'help' lists the commands." }
  if (TERMINAL_ONLY.has(first.toLowerCase())) return { message: `'${first}' only works in a terminal on the server.`, hint: null }
  if (WATCHABLE.has(first.toLowerCase()) && args.some(isWatch))
    return { message: '--watch never ends, so it does not work over the API.', hint: "Ask for 'session --json' as often as you need." }
  return null
}

// A credential keeps its name (CLIENT_SECRET=***); a password keeps nothing.
const hide = (option: string, value: string) => {
  const separator = value.indexOf('=')
  return option === '--credential' && separator > 0 ? `${value.slice(0, separator + 1)}***` : '***'
}

/** The command line as it may be shown and stored: password and credential values replaced by ***. */
export function describe(args: string[]): string {
  const shown: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    const inline = SECRET_OPTIONS.find((option) => arg.length > option.length && arg.startsWith(option) && (arg[option.length] === '=' || arg[option.length] === ':'))
    if (SECRET_OPTIONS.includes(arg) && i + 1 < args.length) {
      shown.push(arg, hide(arg, args[++i] as string))
    } else if (inline) {
      shown.push(arg.slice(0, inline.length + 1) + hide(inline, arg.slice(inline.length + 1)))
    } else {
      shown.push(arg)
    }
  }
  return shown.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')
}

/** The API's body limit (Api/CommandApi.cs MaxBodyBytes); a larger body gets 413. */
export const MAX_BODY_BYTES = 4096
export const bodyFor = (args: string[]) => JSON.stringify({ args })
export const bodyBytes = (args: string[]) => new TextEncoder().encode(bodyFor(args)).length
