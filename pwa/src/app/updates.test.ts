import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates } from './updates.ts'

/** A page whose visibility the test switches, as Android does when an installed app is put away and resumed. */
class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
  show() {
    this.visibilityState = 'visible'
    this.dispatchEvent(new Event('visibilitychange'))
  }
  hide() {
    this.visibilityState = 'hidden'
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

describe('checking for a new version of the app', () => {
  const registration = { update: vi.fn(() => Promise.resolve()) }
  let page: FakePage

  beforeEach(() => {
    vi.useFakeTimers()
    registration.update.mockClear()
    page = new FakePage()
  })
  afterEach(() => vi.useRealTimers())

  it('happens each time the app comes back to the screen, not only when it is launched', () => {
    checkForUpdates(registration, page)

    page.hide()
    page.show()

    expect(registration.update).toHaveBeenCalledOnce()
  })

  it('happens every hour while the app stays open', () => {
    checkForUpdates(registration, page)

    vi.advanceTimersByTime(2 * 60 * 60_000)

    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('stops when asked', () => {
    const stop = checkForUpdates(registration, page)

    stop()
    page.show()
    vi.advanceTimersByTime(60 * 60_000)

    expect(registration.update).not.toHaveBeenCalled()
  })

  it('shrugs off a failed check (offline): the next one tries again', async () => {
    registration.update.mockRejectedValueOnce(new Error('offline'))
    checkForUpdates(registration, page)

    page.show()
    await Promise.resolve()
    page.show()

    expect(registration.update).toHaveBeenCalledTimes(2)
  })
})
