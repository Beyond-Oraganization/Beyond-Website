import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet.tsx'

afterEach(cleanup)

const dialog = () => document.querySelector('dialog') as HTMLDialogElement

describe('Sheet', () => {
  it('reports a close the browser makes (Escape) to its owner', () => {
    const onClose = vi.fn()
    render(<Sheet open onClose={onClose} title="Sure?">Body</Sheet>)
    dialog().close() // as Escape does
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // A browser fires the close event of dialog.close() later, as a task. If the sheet is opened again before it
  // arrives (Cancel, then Enter on the next command), that late event must not close the new sheet.
  it('ignores a late close event that arrives after it has been opened again', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Sheet open onClose={onClose} title="Sure?">Body</Sheet>)
    rerender(<Sheet open={false} onClose={onClose} title="Sure?">Body</Sheet>)
    rerender(<Sheet open onClose={onClose} title="Sure?">Body</Sheet>)
    onClose.mockClear()

    dialog().dispatchEvent(new Event('close'))

    expect(onClose).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
  })

  it('closes from its own close button and from a click on the backdrop', async () => {
    const onClose = vi.fn()
    render(<Sheet open onClose={onClose} title="Sure?">Body</Sheet>)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(dialog())
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
