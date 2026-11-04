import { useEffect, useRef } from 'react'
import { marketLabel } from '../api/intervals.ts'
import type { SessionSnapshot, TradingSessionState } from '../api/types.ts'
import { toast } from '../components/Toasts.tsx'
import { fmtNumber, fmtPrice, fmtSignedMoney } from '../format.ts'
import { useSettings } from '../state/settings.ts'

/** A system notification while the app runs in the background (asked for in Settings only), plus the toast. */
async function notify(title: string, body: string, tone: 'info' | 'success' | 'error') {
  toast.show({ tone, title, text: body })
  if (!useSettings.getState().notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) await registration.showNotification(title, { body, icon: 'pwa-192x192.png', badge: 'pwa-64x64.png', tag: `${title}:${body}` })
    else new Notification(title, { body, icon: 'pwa-192x192.png' })
  } catch {
    // notifications blocked: the toast is enough
  }
}

const same = (a: TradingSessionState, b: TradingSessionState) => marketLabel(a.market) === marketLabel(b.market) && a.strategy === b.strategy

/**
 * Compares each new snapshot with the one before: there is no push channel from the bot, so this is how trades,
 * strategy errors, a stopped strategy, a lost broker and closes at the broker are noticed. Also sets the app
 * badge to the number of open positions where the platform supports it.
 */
export function useSnapshotAlerts(snapshot: SessionSnapshot | null) {
  const previous = useRef<SessionSnapshot | null>(null)
  useEffect(() => {
    if (!snapshot) return
    const before = previous.current
    previous.current = snapshot
    const badge = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    const open = snapshot.positions.filter((p) => !p.isPending).length
    void (open ? badge.setAppBadge?.(open) : badge.clearAppBadge?.())?.catch(() => {})
    if (!before || before.stats.user !== snapshot.stats.user) return
    const currency = snapshot.account.currency

    let strategyClosed = false
    for (const session of snapshot.strategies) {
      const old = before.strategies.find((s) => same(s, session))
      const tick = session.lastTick
      if (tick?.trade && tick.time !== old?.lastTick?.time) {
        const order = tick.trade.order
        if (tick.trade.action === 'Opened')
          void notify(`${marketLabel(session.market)}: opened ${order.side.toLowerCase()}`, `${fmtNumber(order.quantity)} ${order.symbol} @ ${fmtPrice(order.price)} by ${session.strategy}`, 'success')
        else {
          strategyClosed = true
          void notify(`${marketLabel(session.market)}: closed a position`, `Position ${order.orderId} closed by ${session.strategy}`, 'info')
        }
      }
      if (session.lastError && session.lastErrorAt !== old?.lastErrorAt)
        void notify(`${marketLabel(session.market)}: a tick failed`, session.lastError, 'error')
    }
    for (const old of before.strategies)
      if (!snapshot.strategies.some((s) => same(s, old))) void notify(`${marketLabel(old.market)} stopped trading`, `${old.strategy} is no longer running.`, 'info')

    if (before.system.broker.isConnected && !snapshot.system.broker.isConnected)
      void notify('Broker disconnected', snapshot.system.broker.lastError ?? 'The bot lost its connection to the broker.', 'error')

    const realized = snapshot.stats.realizedProfit - before.stats.realizedProfit
    if (Math.abs(realized) >= 0.005 && !strategyClosed)
      void notify('A position closed at the broker', `Realized ${fmtSignedMoney(realized, currency)}`, realized >= 0 ? 'success' : 'info')
  }, [snapshot])
}
