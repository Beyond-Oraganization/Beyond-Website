import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MarketRow } from '../api/parse/markets.ts'
import type { StrategyDefinition } from '../api/parse/strategies.ts'
import { DRCS, LEGACY, MOMENTUM } from '../api/fixtures/catalog.ts'
import { initialConfig, validateConfig, type StrategyConfig } from '../strategy/config.ts'
import { StrategyForm } from './StrategyForm.tsx'

afterEach(cleanup)

const markets: MarketRow[] = [{ symbol: 'XAUUSD', interval: '1h', candles: 1, first: null, newest: null, age: null, trading: false }]

/** The form as a screen uses it: it owns the config and shows the errors of what is typed. */
function Harness({ definitions, seen }: { definitions: StrategyDefinition[]; seen: StrategyConfig[] }) {
  const [config, setConfig] = useState(() => initialConfig(definitions, markets)!)
  const definition = definitions.find((d) => d.name === config.strategy)
  return (
    <StrategyForm
      definitions={definitions}
      markets={markets}
      config={config}
      errors={validateConfig(config, definition)}
      onChange={(next) => {
        seen.push(next)
        setConfig(next)
      }}
    />
  )
}
const setup = (definitions: StrategyDefinition[]) => {
  const seen: StrategyConfig[] = []
  render(<Harness definitions={definitions} seen={seen} />)
  return { seen, last: () => seen.at(-1)!, rule: (n: number) => screen.getByRole('group', { name: `Rule ${n}` }) }
}

describe('the rule editor', () => {
  it('builds each rule from the strategy’s syntax: a menu per choice, a field per number', () => {
    const { rule } = setup([DRCS])
    const first = rule(1)
    expect(within(first).getByRole('combobox', { name: 'Rule 1: open or close' })).toHaveValue('open')
    expect(within(first).getByRole('combobox', { name: 'Rule 1: long or short' })).toHaveValue('long')
    expect(within(first).getByRole('combobox', { name: 'Rule 1: up or down' })).toHaveValue('up')
    expect(within(first).getByRole('combobox', { name: 'Rule 1: lower or upper' })).toHaveValue('lower')
    expect(within(first).getByRole('spinbutton', { name: 'Rule 1: number after lower or upper' })).toHaveValue(1)
    expect(rule(2)).toBeInTheDocument()
  })

  it('works the same for a strategy the app has never heard of', async () => {
    const { rule, last } = setup([MOMENTUM])
    const first = rule(1)
    await userEvent.selectOptions(within(first).getByRole('combobox', { name: 'Rule 1: above or below' }), 'below')
    await userEvent.selectOptions(within(first).getByRole('combobox', { name: 'Rule 1: long or short' }), 'short')
    const [average, candles] = within(first).getAllByRole('spinbutton')
    await userEvent.clear(candles!)
    await userEvent.type(candles!, '5')
    expect(last().rules).toEqual(['open short on below ema 20 for 5 candles'])
    expect(average).toHaveValue(20)
    expect(screen.getByLabelText('threshold')).toHaveValue(0.5)
  })

  it('keeps the controls while a number is half typed, and says what is missing', async () => {
    const { rule } = setup([DRCS])
    const number = within(rule(1)).getByRole('spinbutton')
    await userEvent.clear(number)
    expect(within(rule(1)).getByRole('spinbutton')).toHaveFocus()
    expect(screen.getByText('Write it as: open|close long|short on cross up|down lower|upper N.')).toBeInTheDocument()
  })

  it('adds, moves and removes rules, keeping their order', async () => {
    const { last } = setup([DRCS])
    await userEvent.click(screen.getByRole('button', { name: 'Add a rule' }))
    expect(last().rules).toEqual(['open long on cross up lower 1', 'close long on cross down lower 1', 'open long on cross up lower 1'])
    await userEvent.click(screen.getByRole('button', { name: 'Move rule 2 up' }))
    expect(last().rules[0]).toBe('close long on cross down lower 1')
    await userEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    expect(last().rules).toEqual(['close long on cross down lower 1', 'open long on cross up lower 1'])
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Reset the rules to the defaults' }))
    expect(last().rules).toEqual(DRCS.rules!.defaults)
  })

  it('writes any rule as text, and offers the controls again once the text fits', async () => {
    const { last } = setup([DRCS])
    await userEvent.click(screen.getAllByRole('button', { name: 'Write it as text' })[0]!)
    const text = screen.getByRole('textbox', { name: 'Rule 1' })
    await userEvent.clear(text)
    await userEvent.type(text, 'open short on cross down upper')
    expect(screen.getByRole('button', { name: 'Fix the text to choose it from the lists' })).toBeDisabled()
    await userEvent.type(text, ' 2')
    expect(last().rules[0]).toBe('open short on cross down upper 2')
    await userEvent.click(screen.getByRole('button', { name: 'Choose from the lists' }))
    expect(within(screen.getByRole('group', { name: 'Rule 1' })).getByRole('combobox', { name: 'Rule 1: lower or upper' })).toHaveValue('upper')
  })

  it('edits rules as text when the syntax cannot be built', () => {
    setup([{ ...DRCS, rules: { defaults: ['open long on something new'], syntax: 'open|close long|short on CONDITION' } }])
    expect(screen.getByRole('textbox', { name: 'Rule 1' })).toHaveValue('open long on something new')
    expect(screen.queryByRole('button', { name: 'Write it as text' })).toBeNull()
  })

  it('shows no rules for a bot from before rules', () => {
    setup([LEGACY])
    expect(screen.queryByRole('group', { name: 'Rules' })).toBeNull()
    expect(screen.getByLabelText('trigger')).toHaveValue(1)
  })
})

describe('the strategy and its parameters', () => {
  it('switching strategy brings its parameters and rules', async () => {
    const { last } = setup([DRCS, MOMENTUM])
    await userEvent.selectOptions(screen.getByLabelText('Strategy'), 'momentum')
    expect(last()).toMatchObject({ strategy: 'momentum', params: { threshold: '0.5' }, rules: MOMENTUM.rules!.defaults })
    expect(screen.queryByLabelText('depth')).toBeNull()
  })

  it('shows a parameter’s range error from the catalog', async () => {
    setup([DRCS])
    const depth = screen.getByLabelText('depth')
    await userEvent.clear(depth)
    await userEvent.type(depth, '900')
    expect(screen.getByText('depth must be between 1 and 500.')).toBeInTheDocument()
  })
})

describe('saved setups', () => {
  it('saves a setup and applies it again, keeping the market', async () => {
    const { last } = setup([DRCS])
    await userEvent.click(screen.getByText('Saved setups'))
    await userEvent.click(screen.getAllByRole('button', { name: 'Write it as text' })[0]!)
    const text = screen.getByRole('textbox', { name: 'Rule 1' })
    await userEvent.clear(text)
    await userEvent.type(text, 'open short on cross down upper 1')
    await userEvent.type(screen.getByLabelText('Save this setup as'), 'Short the top')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset the rules to the defaults' }))
    expect(last().rules[0]).toBe('open long on cross up lower 1')
    await userEvent.selectOptions(screen.getByLabelText('Setup'), 'Short the top')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(last()).toMatchObject({ market: 'XAUUSD 1h', rules: ['open short on cross down upper 1', 'close long on cross down lower 1'] })
  })
})
