import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallHelp, stepsFor } from './InstallHelp.tsx'
import { __test, detectPlatform, startInstallWatch, useInstall, type Platform } from './install.ts'

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  edgeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 16; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.0.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  firefoxAndroid: 'Mozilla/5.0 (Android 16; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0',
  instagramIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0',
  androidWebView: 'Mozilla/5.0 (Linux; Android 16; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.0.0 Mobile Safari/537.36',
}

describe('detectPlatform', () => {
  it.each<[keyof typeof UA, number, Platform]>([
    ['chromeWindows', 0, 'chromium'],
    ['edgeMac', 0, 'chromium'],
    ['chromeAndroid', 5, 'chromium'],
    ['samsung', 5, 'chromium'],
    ['safariIphone', 5, 'ios-safari'],
    ['chromeIphone', 5, 'ios-other'],
    ['safariMac', 5, 'ios-safari'], // an iPad presents itself as a Mac, with touch points
    ['safariMac', 0, 'mac-safari'],
    ['firefoxAndroid', 5, 'android-firefox'],
    ['firefoxLinux', 0, 'desktop-firefox'],
    ['instagramIphone', 5, 'in-app'],
    ['androidWebView', 5, 'in-app'],
  ])('%s with %d touch points → %s', (ua, touch, platform) => {
    expect(detectPlatform(UA[ua], touch)).toBe(platform)
  })
})

/** A `beforeinstallprompt` as Chromium fires it, with a dialog the test answers. */
function installPrompt(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn(async () => {})
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome }) })
  return { event, prompt }
}

function as(ua: string, touchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true }) // jsdom has none
}

function Offer() {
  const { offerable, installedNow } = useInstall()
  return (
    <p>
      {offerable ? 'offer install' : 'no install offer'}
      {installedNow ? ', installed now' : ''}
    </p>
  )
}

describe('installing from the app', () => {
  beforeEach(() => {
    __test.reset()
  })
  afterEach(() => {
    cleanup()
    __test.reset()
  })

  it('keeps Chromium’s install event, offers the button and opens the browser’s dialog', async () => {
    as(UA.chromeWindows)
    startInstallWatch()
    render(
      <>
        <Offer />
        <InstallHelp />
      </>,
    )
    expect(screen.getByText('no install offer')).toBeInTheDocument()
    const { event, prompt } = installPrompt('accepted')
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true) // Android's mini-bar does not compete with the app's button
    expect(screen.getByText('offer install')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Install Beyond Bot' }))
    expect(prompt).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Install Beyond Bot' })).toBeNull() // the event is used up
  })

  it('hides the offer once the browser says the app is installed', () => {
    as(UA.chromeAndroid, 5)
    const installed = vi.fn()
    startInstallWatch(installed)
    render(<Offer />)
    act(() => {
      window.dispatchEvent(installPrompt('accepted').event)
    })
    expect(screen.getByText('offer install')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(installed).toHaveBeenCalledOnce()
    expect(screen.getByText('no install offer, installed now')).toBeInTheDocument()
  })

  it('never offers to install inside the installed app', () => {
    as(UA.safariIphone, 5)
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(display-mode: standalone)', media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    )
    __test.reset()
    render(
      <>
        <Offer />
        <InstallHelp />
      </>,
    )
    expect(screen.getByText('no install offer')).toBeInTheDocument()
    expect(screen.getByText('Installed')).toBeInTheDocument()
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull()
  })

  it.each<[keyof typeof UA, number, RegExp, boolean]>([
    ['safariIphone', 5, /Add to Home Screen/, true],
    ['chromeIphone', 5, /Add to Home Screen/, true],
    ['safariMac', 0, /Add to Dock/, true],
    ['firefoxAndroid', 5, /Install/, true],
    ['chromeWindows', 0, /Install Beyond Bot/, true],
    ['firefoxLinux', 0, /Chrome|Edge|Safari/, false],
    ['instagramIphone', 5, /Open this address in your browser/, false],
  ])('%s shows its own steps', (ua, touch, step, canInstall) => {
    as(UA[ua], touch)
    render(<InstallHelp />)
    expect(screen.getAllByRole('listitem').some((item) => step.test(item.textContent ?? ''))).toBe(true)
    // Browsers that cannot install offer the link, to open it in one that can.
    expect(Boolean(screen.queryByRole('button', { name: 'Copy link' }))).toBe(!canInstall)
    expect(stepsFor(detectPlatform(UA[ua], touch)).canInstall).toBe(canInstall)
  })

  it('tells iPhone users to install before connecting (the installed app has its own storage)', () => {
    as(UA.safariIphone, 5)
    render(<InstallHelp />)
    expect(screen.getByText('Install first, then connect')).toBeInTheDocument()
  })
})
