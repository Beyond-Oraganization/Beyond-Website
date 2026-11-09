/** How often an app left open looks for a new version. */
const HOURLY = 60 * 60_000

type Page = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState: DocumentVisibilityState }

/**
 * Looks for a new version of the app each time it comes back to the screen and every hour. The browser looks only
 * when the app is launched, and Android mostly resumes an installed app instead, so without this a phone can keep
 * an old version for days. A failed look (offline) is ignored; the next one tries again. Returns how to stop.
 */
export function checkForUpdates(registration: { update: () => Promise<unknown> }, page: Page = document, everyMs = HOURLY): () => void {
  const check = () => void registration.update().catch(() => undefined)
  const onVisible = () => {
    if (page.visibilityState === 'visible') check()
  }
  page.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(check, everyMs)
  return () => {
    page.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
  }
}
