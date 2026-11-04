/**
 * A strategy's rules, built from the syntax the bot gives for them in `strategies --json`, such as
 * `open|close long|short on cross up|down lower|upper N`. Each word of the syntax is one position of a rule: a
 * fixed word (`on`), a choice (`up|down`) or a number (`N`). The app knows no strategy: a new strategy, or a new
 * kind of condition, written the same way works here unchanged. A syntax it cannot build (a placeholder it does
 * not know, such as `CONDITION`) gives no grammar, and the rule is then written as text; the bot checks it either way.
 */

export type RuleSlot = { kind: 'word'; text: string } | { kind: 'choice'; options: string[] } | { kind: 'number' }

export type RuleGrammar = { syntax: string; slots: RuleSlot[] }

/** The bot's own placeholder for a whole number in a rule (EnvelopeBand reads it with NumberStyles.None). */
const NUMBER = 'N'
const PLACEHOLDER = /^[A-Z][A-Z0-9_]*$/
const WHOLE = /^\d+$/

function slotOf(token: string): RuleSlot | null {
  if (token.includes('|')) {
    const options = token.split('|')
    return options.every(Boolean) ? { kind: 'choice', options } : null
  }
  if (token === NUMBER) return { kind: 'number' }
  if (PLACEHOLDER.test(token)) return null
  return { kind: 'word', text: token }
}

export function compileRuleSyntax(syntax: string): RuleGrammar | null {
  const tokens = syntax.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  const slots: RuleSlot[] = []
  for (const token of tokens) {
    const slot = slotOf(token)
    if (!slot) return null
    slots.push(slot)
  }
  return { syntax, slots }
}

/** One value per position (fixed words included), in the canonical case; null when the text is not such a rule. */
export function readRule(grammar: RuleGrammar, text: string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length !== grammar.slots.length) return null
  const values: string[] = []
  for (const [index, slot] of grammar.slots.entries()) {
    const word = words[index]!
    if (slot.kind === 'word') {
      if (word.toLowerCase() !== slot.text.toLowerCase()) return null
      values.push(slot.text)
    } else if (slot.kind === 'choice') {
      const option = slot.options.find((candidate) => candidate.toLowerCase() === word.toLowerCase())
      if (!option) return null
      values.push(option)
    } else {
      if (!WHOLE.test(word)) return null
      values.push(String(Number(word)))
    }
  }
  return values
}

export const writeRule = (grammar: RuleGrammar, values: string[]) => grammar.slots.map((slot, index) => (slot.kind === 'word' ? slot.text : values[index] ?? '')).join(' ')

/** A new rule: the first example that fits (the strategy's default rules), otherwise the first choice of each position. */
export function ruleTemplate(grammar: RuleGrammar, examples: string[]): string {
  const example = examples.map((text) => readRule(grammar, text)).find((values) => values !== null)
  if (example) return writeRule(grammar, example)
  return writeRule(grammar, grammar.slots.map((slot) => (slot.kind === 'choice' ? slot.options[0]! : slot.kind === 'number' ? '1' : slot.text)))
}

/** What a position chooses, for its control's accessible name: "up or down", "number after lower or upper". */
export function slotLabel(grammar: RuleGrammar, index: number): string {
  const slot = grammar.slots[index]
  if (!slot) return ''
  if (slot.kind === 'word') return slot.text
  if (slot.kind === 'choice') return slot.options.join(' or ')
  const before = index > 0 ? slotLabel(grammar, index - 1) : ''
  return before ? `number after ${before}` : 'number'
}
