import { useEffect, useState } from 'react'
import { queryClient, useBot } from '../api/bot.ts'
import { DataTable } from '../components/DataTable.tsx'
import { Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, Section } from '../components/ui.tsx'
import { InstallHelp } from '../install/InstallHelp.tsx'
import { useInstall } from '../install/install.ts'
import { deleteCopy, listCopies, type CopyInfo } from '../data/candles.ts'
import { fmtBytes, fmtCount, fmtRelative, fmtTime } from '../format.ts'
import { db } from '../state/db.ts'
import { useLogs } from '../state/logs.ts'
import { useSettings } from '../state/settings.ts'
import { useTheme } from '../theme.ts'

export default function Settings() {
  const settings = useSettings()
  const { theme, followSystem, setTheme, setFollowSystem } = useTheme()
  const { standalone } = useInstall()
  const { connection } = useBot()
  const clearLog = useLogs((state) => state.clear)
  const [copies, setCopies] = useState<CopyInfo[] | null>(null)
  useEffect(() => {
    if (connection) void listCopies(connection.id).then(setCopies)
  }, [connection])
  const forget = async (markets: string[]) => {
    if (!connection) return
    for (const market of markets) await deleteCopy(connection.id, market)
    setCopies(await listCopies(connection.id))
  }
  const themeValue = followSystem ? 'system' : theme

  const askNotifications = async (on: boolean) => {
    if (!on) return void settings.change({ notifications: false })
    if (typeof Notification === 'undefined') return toast.error('Not available', 'This browser has no notifications.')
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission === 'granted') {
      await settings.change({ notifications: true })
      toast.success('Notifications on', 'Trades and errors are announced while the app runs.')
    } else toast.error('Notifications are blocked', 'Allow them for this site in the browser’s settings.')
  }

  return (
    <>
      <ScreenHead kicker="Settings" title="Settings." lead="Kept on this device." />
      <Section variant="alt" label="Install">
        <div className="g2">
          <div className="stack-sm">
            <h2 className="h2">Install on this device</h2>
            <p className="label mute">{standalone ? 'Installed' : 'Not installed here'}</p>
          </div>
          <InstallHelp />
        </div>
      </Section>
      <Section label="Appearance and refresh">
        <div className="stack">
          <Segmented
            name="theme"
            legend="Theme"
            value={themeValue}
            onChange={(value) => (value === 'system' ? setFollowSystem(true) : setTheme(value))}
            options={[
              { value: 'classic', label: 'Classic' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Follow the device' },
            ]}
            hint="The website’s two themes, shared with it. Following the device picks Light in light mode and Classic in dark mode."
          />
          <Segmented
            name="refresh"
            legend="Read the session every"
            value={String(settings.refreshSeconds)}
            onChange={(value) => void settings.change({ refreshSeconds: Number(value) })}
            options={[2, 5, 10, 30, 60].map((n) => ({ value: String(n), label: `${n} s` }))}
            hint="Only while the app is visible and online. Prices move only while something reads the session, so faster means fresher prices."
          />
        </div>
      </Section>
      <Section variant="alt" label="Notifications and security">
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={settings.notifications} onChange={(event) => void askNotifications(event.target.checked)} />
            System notifications for trades, strategy errors and a lost broker, while the app runs
          </label>
          <p className="hint">The bot has no push channel, so nothing arrives while the app is closed.</p>
          <Segmented
            name="lock"
            legend="Lock after the app is in the background for"
            value={String(settings.autoLockMinutes)}
            onChange={(value) => void settings.change({ autoLockMinutes: Number(value) })}
            options={[1, 15, 60, 480].map((n) => ({ value: String(n), label: n < 60 ? `${n} min` : `${n / 60} h` }))}
            hint="Keys sealed with a passphrase are then forgotten until you type it again."
          />
        </div>
      </Section>
      <Section label="Data on this device">
        <div className="stack">
          <p className="p">This device remembers the last answers (to start offline), the ticks it saw, your saved backtests and what it asked the bot.</p>
          <div className="stack-sm">
            <h2 className="h3">Candles for backtests</h2>
            <p className="hint">Copied from the bot the first time you backtest a market, then brought up to date before each backtest. Clearing one costs a download the next time.</p>
            {copies?.length ? (
              <DataTable
                caption="Candle copies on this device"
                rows={copies}
                rowKey={(copy) => copy.market}
                columns={[
                  { key: 'market', header: 'Market', card: 'title', render: (copy) => copy.market },
                  { key: 'candles', header: 'Candles', align: 'right', card: 'sub', render: (copy) => fmtCount(copy.count) },
                  { key: 'range', header: 'From → to (UTC)', render: (copy) => `${fmtTime(copy.first)} → ${fmtTime(copy.newest)}` },
                  { key: 'size', header: 'Size', align: 'right', render: (copy) => fmtBytes(copy.bytes) },
                  { key: 'updated', header: 'Updated', render: (copy) => fmtRelative(copy.updatedAt) },
                ]}
                actions={(copy) => (
                  <Button compact variant="ghost" onClick={() => void forget([copy.market])}>
                    Clear
                  </Button>
                )}
              />
            ) : (
              <p className="p mute">{copies ? 'None yet.' : connection ? 'Reading…' : 'Connect a bot to see them.'}</p>
            )}
          </div>
          <div className="btn-row">
            <Button
              variant="ghost"
              onClick={async () => {
                await db.delPrefixed('cache:')
                queryClient.clear()
                toast.info('Cleared', 'Last answers are read again.')
              }}
            >
              Clear the last answers
            </Button>
            <Button variant="ghost" disabled={!connection} onClick={() => connection && clearLog(connection.id, 'ticks')}>
              Clear the tick feed
            </Button>
            <Button variant="ghost" disabled={!connection} onClick={() => connection && clearLog(connection.id, 'activity')}>
              Clear the activity log
            </Button>
            <Button variant="ghost" disabled={!copies?.length} onClick={() => void forget(copies?.map((copy) => copy.market) ?? [])}>
              Clear every candle copy
            </Button>
            <Button
              variant="ghost"
              disabled={!connection}
              onClick={async () => {
                if (!connection) return
                await db.del(`backtests:${connection.id}`)
                toast.info('Cleared', 'Saved backtests are gone from this device.')
              }}
            >
              Clear the saved backtests
            </Button>
          </div>
        </div>
      </Section>
      <Section variant="alt" label="About">
        <Callout label={`Beyond Bot ${__APP_VERSION__}`}>
          <p>A web app for the Beyond Bot trading bot, in the design of the Beyondia website.</p>
          <p className="small">
            Charts: TradingView Lightweight Charts™, copyright TradingView, Inc.,{' '}
            <a className="underline" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
              tradingview.com
            </a>{' '}
            (Apache-2.0). Fonts: Archivo Black and IBM Plex (SIL Open Font License), served from this site.
          </p>
          <p className="small">
            <a className="underline" href="../techbot.html">
              Beyond Bot on the Beyondia website
            </a>
          </p>
        </Callout>
      </Section>
    </>
  )
}
