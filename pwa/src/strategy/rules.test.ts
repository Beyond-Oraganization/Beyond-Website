import { describe, expect, it } from 'vitest'
import { compileRuleSyntax, readRule, ruleTemplate, slotLabel, writeRule } from './rules.ts'

const DRCS = 'open|close long|short on cross up|down lower|upper N'

describe('compileRuleSyntax', () => {
  it('turns the bot’s syntax into words, choices and numbers, in order', () => {
    expect(compileRuleSyntax(DRCS)?.slots).toEqual([
      { kind: 'choice', options: ['open', 'close'] },
      { kind: 'choice', options: ['long', 'short'] },
      { kind: 'word', text: 'on' },
      { kind: 'word', text: 'cross' },
      { kind: 'choice', options: ['up', 'down'] },
      { kind: 'choice', options: ['lower', 'upper'] },
      { kind: 'number' },
    ])
  })

  it('reads any strategy written the same way, with no knowledge of it', () => {
    expect(compileRuleSyntax('open|close long|short on above|below ema N for N candles')?.slots.map((slot) => slot.kind)).toEqual([
      'choice', 'choice', 'word', 'choice', 'word', 'number', 'word', 'number', 'word',
    ])
  })

  it('gives up on a syntax it cannot build, so the rule is written as text instead', () => {
    expect(compileRuleSyntax('open|close long|short on CONDITION')).toBeNull() // a placeholder it does not know
    expect(compileRuleSyntax('open|close long|short on cross up||down N')).toBeNull() // an empty choice
    expect(compileRuleSyntax('   ')).toBeNull()
  })
})

describe('readRule and writeRule', () => {
  const grammar = compileRuleSyntax(DRCS)!

  it('reads a rule into one value per position and writes it back', () => {
    const values = readRule(grammar, 'open short on cross down upper 2')
    expect(values).toEqual(['open', 'short', 'on', 'cross', 'down', 'upper', '2'])
    expect(writeRule(grammar, values!)).toBe('open short on cross down upper 2')
  })

  it('accepts any case and spacing, as the bot does, and writes the canonical form', () => {
    expect(writeRule(grammar, readRule(grammar, '  OPEN Long  on cross UP lower 1 ')!)).toBe('open long on cross up lower 1')
  })

  it('does not read what the bot would refuse', () => {
    for (const text of ['open long on cross up lower', 'open long on cross up lower 1 extra', 'hold long on cross up lower 1', 'open long at cross up lower 1', 'open long on cross up lower x', 'open long on cross up lower -1', 'open long on cross up lower 1.5', ''])
      expect(readRule(grammar, text), text).toBeNull()
  })
})

describe('ruleTemplate', () => {
  it('starts a new rule from an example, or from the first choice of each position', () => {
    const grammar = compileRuleSyntax(DRCS)!
    expect(ruleTemplate(grammar, ['close long on cross down lower 1'])).toBe('close long on cross down lower 1')
    expect(ruleTemplate(grammar, [])).toBe('open long on cross up lower 1')
    expect(ruleTemplate(grammar, ['not a rule'])).toBe('open long on cross up lower 1')
  })
})

describe('slotLabel', () => {
  it('names each control by what it chooses, for screen readers', () => {
    const grammar = compileRuleSyntax(DRCS)!
    expect(grammar.slots.map((_, index) => slotLabel(grammar, index))).toEqual([
      'open or close', 'long or short', 'on', 'cross', 'up or down', 'lower or upper', 'number after lower or upper',
    ])
  })
})
