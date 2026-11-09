import { LockBot } from '../components/LockBot.tsx'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { restoreCache, useBot, useBotHealth, useBusy } from '../api/bot.ts'
import { checkForUpdates } from './updates.ts'
import { describedBy, Field } from '../components/Field.tsx'
import { BotMark, Icon } from '../components/Icon.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { Button, IconButton, cx } from '../components/ui.tsx'
import { fmtClock, fmtElapsed } from '../format.ts'
import { useNow, useOnline } from '../hooks/env.ts'
import { useSessionRuntime } from '../hooks/session.ts'
import { InstallHelp } from '../install/InstallHelp.tsx'
import { useInstall } from '../install/install.ts'
import { useConnections } from '../state/connections.ts'
import { useSettings } from '../state/settings.ts'
import { useUi } from '../state/ui.ts'
import { WrongPassphrase } from '../state/vault.ts'
import { useTheme } from '../theme.ts'
import { useSnapshotAlerts } from './alerts.ts'
import { MORE, NAV } from './nav.ts'
import { CommandPalette } from './Palette.tsx'

function ConnectionChip() {
  const { connection } = useBot()
  const health = useBotHealth()
  const busy = useBusy()
  const navigate = useNavigate()
  if (!connection)
    return (
      <Link to="/connect" className="conn">
        <span className="conn-dot" aria-hidden="true" />
        <span className="name">Connect</span>
      </Link>
    )
  const state = health.unauthorized || health.unreachable ? 'bad' : busy ? 'busy' : health.lastOkAt ? 'ok' : ''
  const words = health.unauthorized ? 'key refused' : health.unreachable ? 'unreachable' : busy ? 'busy' : health.lastOkAt ? 'connected' : 'connecting'
  // The bot, and the trading account its answers act on (none until this device signs in to one).
  const account = health.account
  const shown = account ? `${connection.name} · ${account}` : connection.name
  return (
    <button
      type="button"
      className="conn"
      onClick={() => navigate('/connections')}
      // Starts with the visible text, so voice control finds the button by what it shows.
      aria-label={`${shown}: ${words}${account ? '' : ', no trading account'}. Manage connections`}
    >
      <span className={cx('conn-dot', state)} aria-hidden="true" />
      <span className="name">{shown}</span>
    </button>
  )
}

function Header() {
  const { theme, toggle } = useTheme()
  const { offerable } = useInstall()
  const ui = useUi()
  const navigate = useNavigate()
  const { connection, ready } = useBot()
  const [locking, setLocking] = useState(false)
  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link to="/" className="brand" aria-label="Beyond Bot, Session">
          <BotMark size={40} />
          <span>BEYOND BOT</span>
        </Link>
        <nav aria-label="Main navigation" className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="hdr-tools">
          <ConnectionChip />
          {offerable ? <IconButton icon="install" label="Install" showLabel onClick={() => ui.set({ installOpen: true })} /> : null}
          <IconButton icon="sun" label="Light theme" showLabel aria-pressed={theme === 'light'} onClick={toggle} />
          {connection && ready ? <IconButton icon="lock" label="Lock the bot" className="desktop-only" onClick={() => setLocking(true)} /> : null}
          <IconButton icon="settings" label="Settings" className="desktop-only" onClick={() => navigate('/settings')} />
        </div>
      </div>
      <LockBot open={locking} onClose={() => setLocking(false)} />
    </header>
  )
}

function BottomNav() {
  const ui = useUi()
  const location = useLocation()
  const inMore = MORE.some((item) => location.pathname.startsWith(item.to))
  return (
    <nav className="bnav" aria-label="Screens">
      {NAV.slice(0, 4).map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          <Icon name={item.icon} />
          {item.label}
        </NavLink>
      ))}
      <button type="button" className={cx(inMore && 'active')} aria-expanded={ui.moreOpen} aria-haspopup="dialog" onClick={() => ui.set({ moreOpen: true })}>
        <Icon name="more" />
        More
      </button>
    </nav>
  )
}

function MoreSheet() {
  const ui = useUi()
  const { connection, ready } = useBot()
  const [locking, setLocking] = useState(false)
  const close = () => ui.set({ moreOpen: false })
  return (
    <>
      <Sheet open={ui.moreOpen} onClose={close} title="More">
        <nav aria-label="More screens" className="menu-list">
          {MORE.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={close}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
          {connection && ready ? (
            <button
              type="button"
              onClick={() => {
                close()
                setLocking(true)
              }}
            >
              <Icon name="lock" />
              Lock the bot
            </button>
          ) : null}
        </nav>
      </Sheet>
      <LockBot open={locking} onClose={() => setLocking(false)} />
    </>
  )
}

function BusyBar() {
  const busy = useBusy()
  const now = useNow(500)
  const show = busy && (busy.priority !== 'poll' || now - busy.since > 1500) && now - busy.since > 300
  const long = busy && busy.priority === 'interactive' && now - busy.since > 2000
  return (
    <>
      {show ? <div className="busybar" aria-hidden="true" /> : null}
      <div role="status" aria-live="polite" className={long ? 'banner calm' : 'vh'}>
        {long ? `The bot is busy: ${busy.command}, ${fmtElapsed(now - busy.since)}` : ''}
      </div>
    </>
  )
}

function Banners() {
  const online = useOnline()
  const health = useBotHealth()
  const { connection } = useBot()
  const navigate = useNavigate()
  if (!connection) return null
  if (!online)
    return (
      <div className="banner" role="status">
        Offline: showing the bot as this device last saw it.
      </div>
    )
  if (health.unauthorized)
    return (
      <div className="banner" role="alert">
        The bot refused the API key.
        <button type="button" className="link" onClick={() => navigate('/connections')}>
          Fix it in Connections
        </button>
      </div>
    )
  if (health.unreachable)
    return (
      <div className="banner" role="alert">
        The bot cannot be reached{health.lastOkAt ? ` (last answer ${fmtClock(health.lastOkAt)} UTC)` : ''}.
        <button type="button" className="link" onClick={() => navigate('/connections')}>
          Check the connection
        </button>
      </div>
    )
  if (health.signedOut)
    return (
      <div className="banner calm" role="status">
        No trading account on this device: markets and backtests work, trading needs one.
        <button type="button" className="link" onClick={() => navigate('/account')}>
          Add a trading account
        </button>
      </div>
    )
  return null
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => {
      if (registration) checkForUpdates(registration)
    },
  })
  const busy = useBusy()
  if (!needRefresh) return null
  return (
    <div className="banner calm" role="status">
      A new version of Beyond Bot is ready.
      <button type="button" className="link" disabled={Boolean(busy && busy.priority === 'interactive')} onClick={() => void updateServiceWorker(true)}>
        Reload now
      </button>
      <button type="button" className="link" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  )
}

/** Asks for the passphrase (or the key itself) when the active bot's key is not open on this device. */
function Unlock() {
  const { connection } = useBot()
  const { unlock, enterKey, connections, setActive } = useConnections()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()
  if (!connection) return null
  const asksKey = connection.storage === 'session' || !connection.sealed

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (asksKey) {
      if (value.trim().length < 32) return setError('The API key has at least 32 characters.')
      enterKey(connection.id, value)
      return
    }
    setBusy(true)
    try {
      await unlock(connection.id, value)
    } catch (failure) {
      setError(failure instanceof WrongPassphrase ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sec dark" aria-labelledby={`${id}-title`}>
      <div className="wrap">
        <p className="kicker">Locked</p>
        <h1 className="title" id={`${id}-title`}>
          Unlock {connection.name}.
        </h1>
        <p className="lead on-band">
          {asksKey
            ? 'This device does not keep the API key for this bot. Paste it to connect for this visit.'
            : connection.relock
              ? 'You locked this bot. The passphrase you chose opens it; it is then remembered on this device again.'
              : 'The API key is sealed on this device. Your passphrase opens it.'}
        </p>
        <form className="form" style={{ marginTop: 28 }} onSubmit={submit}>
          <Field id={id} label={asksKey ? 'API key' : 'Passphrase'} error={error}>
            <input
              id={id}
              type="password"
              className={cx(asksKey && 'mono')}
              autoComplete={asksKey ? 'off' : 'current-password'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(id, null, error)}
              autoFocus
            />
          </Field>
          <div className="btn-row">
            <Button type="submit" busy={busy} icon="lock">
              Unlock
            </Button>
            {connections.length > 1 ? (
              <Button variant="ghost" onClick={() => void setActive(connections.find((c) => c.id !== connection.id)?.id ?? null)}>
                Use another bot
              </Button>
            ) : null}
            <Link className="more" to="/connections">
              Connections <Icon name="arrow" />
            </Link>
          </div>
        </form>
      </div>
    </section>
  )
}

/** Forgets passphrase keys after the app has spent `autoLockMinutes` in the background. */
function useAutoLock() {
  const lock = useConnections((state) => state.lock)
  useEffect(() => {
    let hiddenAt = 0
    const changed = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > useSettings.getState().autoLockMinutes * 60_000) lock()
    }
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [lock])
}

function useShortcuts() {
  const navigate = useNavigate()
  const ui = useUi()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (typing || document.querySelector('dialog[open]')) return
      if (event.key === ':' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        ui.set({ paletteOpen: true })
      }
      const digit = Number(event.key)
      if (event.altKey && digit >= 1 && digit <= NAV.length) {
        event.preventDefault()
        navigate(NAV[digit - 1]!.to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, ui])
}

function Runtime() {
  const query = useSessionRuntime()
  useSnapshotAlerts(query.data?.parsed.ok ? query.data.parsed.value : null)
  return null
}

const OPEN_WITHOUT_BOT = ['/connect', '/connections', '/install', '/settings']

export function Shell() {
  const { connection, ready } = useBot()
  const loaded = useConnections((state) => state.loaded)
  const location = useLocation()
  const navigate = useNavigate()
  const ui = useUi()
  useAutoLock()
  useShortcuts()

  useEffect(() => {
    if (connection) void restoreCache(connection.id)
  }, [connection])
  useEffect(() => {
    if (loaded && !connection && !OPEN_WITHOUT_BOT.some((path) => location.pathname.startsWith(path))) navigate('/connect', { replace: true })
  }, [loaded, connection, location.pathname, navigate])
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [location.pathname])

  const open = OPEN_WITHOUT_BOT.some((path) => location.pathname.startsWith(path))
  return (
    <div className="page">
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <Header />
      <BusyBar />
      <UpdatePrompt />
      <Banners />
      <main id="main" tabIndex={-1} className="main">
        {!loaded ? null : connection && !ready && !open ? <Unlock /> : <Outlet />}
      </main>
      <BottomNav />
      <MoreSheet />
      <Sheet open={ui.installOpen} onClose={() => ui.set({ installOpen: false })} title="Install Beyond Bot">
        <InstallHelp />
      </Sheet>
      <CommandPalette />
      <Toasts />
      {ready ? <Runtime /> : null}
    </div>
  )
}
