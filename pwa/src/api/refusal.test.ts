import { describe as group, expect, it } from 'vitest'
import { bodyBytes, describe, normalize, refusal, splitCommandLine } from './refusal.ts'

group('describe (port of CommandRunnerTests.Describe_HidesSecrets)', () => {
  it.each([
    ['login demo --password ***', ['login', 'demo', '--password', 's3cret']],
    ['login demo --password=***', ['login', 'demo', '--password=s3cret']],
    ['login demo --password:***', ['login', 'demo', '--password:s3cret']],
    ['credentials --password *** --new-password ***', ['credentials', '--password', 'a', '--new-password', 'b']],
    ['register bob --credential CLIENT_SECRET=*** --credential CLIENT_ID=***', ['register', 'bob', '--credential', 'CLIENT_SECRET=x', '--credential', 'CLIENT_ID=1']],
    ['register bob --credential=ACCESS_TOKEN=***', ['register', 'bob', '--credential=ACCESS_TOKEN=t']],
    ['market list', ['market', 'list']],
    ['login demo --password', ['login', 'demo', '--password']],
    ['say "a b"', ['say', 'a b']],
  ])('%s', (expected, args) => expect(describe(args)).toBe(expected))
})

group('refusal (port of CommandRunner.Refusal)', () => {
  it.each([[['ui']], [['UI']], [['exit']], [['quit']], [['shell']], [['serve']], [['run', 'drcs', '-d']], [['session', '--watch']], [['balance', '-w', '5']], [['positions', '--watch=3']], [[]]])(
    'refuses %j',
    (args) => expect(refusal(args)).not.toBeNull(),
  )
  it('lets ordinary commands through', () => {
    expect(refusal(['market', 'list'])).toBeNull()
    expect(refusal(['session', '--json'])).toBeNull()
    expect(refusal(['orders', 'place', 'XAUUSD', 'buy', '1', '--yes'])).toBeNull()
  })
})

group('splitCommandLine (port of Arguments.Split)', () => {
  it('splits on spaces and groups double quotes', () => {
    expect(splitCommandLine('backtest drcs --set depth=30')).toEqual(['backtest', 'drcs', '--set', 'depth=30'])
    expect(splitCommandLine('login "my name"  --password x')).toEqual(['login', 'my name', '--password', 'x'])
    expect(splitCommandLine('   ')).toEqual([])
  })
  it('turns a lone help into --help', () => {
    expect(normalize(['help'])).toEqual(['--help'])
    expect(normalize(['?'])).toEqual(['--help'])
    expect(normalize(['help', 'market'])).toEqual(['help', 'market'])
  })
  it('measures the JSON body in bytes', () => {
    expect(bodyBytes(['a'])).toBe(JSON.stringify({ args: ['a'] }).length)
    expect(bodyBytes(['é'])).toBe(JSON.stringify({ args: ['é'] }).length + 1)
  })
})
