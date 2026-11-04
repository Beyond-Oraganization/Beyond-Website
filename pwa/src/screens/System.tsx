import { useBot } from '../api/bot.ts'
import { marketLabel } from '../api/intervals.ts'
import { parseIso, parseTimeSpan } from '../api/parse/format.ts'
import { Answer } from '../components/Answer.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { toast } from '../components/Toasts.tsx'
import { Callout, EmptyState, Pill, Section } from '../components/ui.tsx'
import { fmtBytes, fmtClock, fmtDuration, fmtElapsed, fmtTime } from '../format.ts'
import { useStatus } from '../hooks/data.ts'
import { useSessionData } from '../hooks/session.ts'
import { useActivity, useLogs } from '../state/logs.ts'

const copy = (text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success('Copied', text))
    .catch(() => toast.error('Could not copy', text))

function CopyLine({ text }: { text: string }) {
  return (
    <p className="row">
      <code className="mono">{text}</code>
      <button type="button" className="link small" onClick={() => void copy(text)}>
        Copy
      </button>
    </p>
  )
}

export default function System() {
  const status = useStatus()
  const session = useSessionData()
  const { connection } = useBot()
  const activity = useActivity(connection?.id)
  const clear = useLogs((state) => state.clear)
  const snapshot = session.data?.parsed.ok ? session.data.parsed.value : null
  const logPath = snapshot?.system.logPath ?? (status.data?.parsed.ok ? status.data.parsed.value.log : null)

  return (
    <>
      <ScreenHead kicker="System" title="Health." lead="The bot’s own health check, its process, and what this device asked it." />
      <Section variant="alt" label="Health check">
        <h2 className="h2" style={{ marginBottom: 16 }}>
          status
        </h2>
        <Answer query={status}>
          {(value) => (
            <dl className="dl">
              <dt>Version</dt>
              <dd>
                {value.version ?? '–'}, up {fmtDuration(value.uptime)} {value.version && !value.version.startsWith('2.') ? <Pill tone="accent">Untested version</Pill> : null}
              </dd>
              <dt>Database</dt>
              <dd>
                {value.database.text} {value.database.connected ? null : <Pill tone="accent">Down</Pill>}
              </dd>
              <dt>User</dt>
              <dd>{value.user ?? 'not logged in'}</dd>
              <dt>Broker</dt>
              <dd>{value.broker.text}</dd>
              <dt>Trading</dt>
              <dd>{value.trading} strategy session(s)</dd>
              <dt>Credentials</dt>
              <dd>{value.credentials}</dd>
              <dt>Log</dt>
              <dd>{value.log}</dd>
            </dl>
          )}
        </Answer>
      </Section>
      {snapshot ? (
        <Section label="Process">
          <h2 className="h2" style={{ marginBottom: 16 }}>
            Process
          </h2>
          <dl className="dl">
            <dt>Broker</dt>
            <dd>
              {snapshot.system.broker.isConnected ? 'connected' : 'disconnected'}
              {snapshot.system.broker.connectedSince ? `, since ${fmtTime(parseIso(snapshot.system.broker.connectedSince))} UTC` : ''}
              {snapshot.system.broker.lastLatency ? `, last answer in ${fmtElapsed((parseTimeSpan(snapshot.system.broker.lastLatency) ?? 0) * 1000)}` : ''}
              {snapshot.system.broker.lastError ? ` (${snapshot.system.broker.lastError})` : ''}
            </dd>
            <dt>Database</dt>
            <dd>
              {snapshot.system.database
                ? `${snapshot.system.database.database}@${snapshot.system.database.server}, schema v${snapshot.system.database.schemaVersion}, MySQL ${snapshot.system.database.serverVersion ?? '?'}, ${fmtElapsed((parseTimeSpan(snapshot.system.database.latency) ?? 0) * 1000)}`
                : 'not checked'}
              {snapshot.system.databaseCheckedAt ? `; checked ${fmtClock(parseIso(snapshot.system.databaseCheckedAt))} UTC` : ''}
            </dd>
            <dt>In memory</dt>
            <dd>
              {snapshot.system.markets.length
                ? snapshot.system.markets.map((m) => `${marketLabel(m.market)}: ${m.candles} candles, ${fmtDuration(parseTimeSpan(m.age))} old`).join(' · ')
                : 'no market loaded'}
            </dd>
            <dt>Memory</dt>
            <dd>
              {fmtBytes(snapshot.system.managedMemoryBytes)} managed, {fmtBytes(snapshot.system.workingSetBytes)} working set
            </dd>
            <dt>Process</dt>
            <dd>
              version {snapshot.system.version}, up {fmtDuration(parseTimeSpan(snapshot.system.processUptime))}
            </dd>
          </dl>
        </Section>
      ) : null}
      <Section variant="dark" label="Logs">
        <div className="stack" style={{ maxWidth: '48em' }}>
          <h2 className="h2">Logs live on the server</h2>
          <p className="lead on-band">The command API has no log command, so the app cannot show the bot’s log. On the server:</p>
          <CopyLine text="journalctl -u beyondbot -f" />
          {logPath ? <CopyLine text={`tail -f ${logPath}`} /> : null}
          <p className="hint">Daily files are kept for 14 days; warnings and the API’s commands are in them.</p>
        </div>
      </Section>
      <Section variant="alt" label="App activity">
        <div className="section-title">
          <h2 className="h2">What this device asked</h2>
          {activity.length && connection ? (
            <button type="button" className="link small" onClick={() => clear(connection.id, 'activity')}>
              Clear
            </button>
          ) : null}
        </div>
        {activity.length ? (
          <DataTable
            caption="Commands this device ran"
            rows={[...activity].reverse()}
            rowKey={(row, index) => `${row.at}-${index}`}
            columns={[
              { key: 'command', header: 'Command', card: 'title', wrap: true, render: (row) => <span className="mono">{row.command}</span> },
              { key: 'outcome', header: 'Result', card: 'sub', render: (row) => (row.outcome === 'ok' ? 'ok' : <Pill tone="accent">{row.exitCode != null ? `exit ${row.exitCode}` : row.outcome}</Pill>) },
              { key: 'elapsed', header: 'Bot time', align: 'right', render: (row) => fmtElapsed(row.elapsedMs) },
              { key: 'round', header: 'Round trip', align: 'right', render: (row) => fmtElapsed(row.roundTripMs) },
              { key: 'at', header: 'At (UTC)', render: (row) => fmtClock(row.at) },
            ]}
          />
        ) : (
          <EmptyState title="Nothing yet.">Actions and failed reads appear here, with passwords hidden. The last 500 are kept.</EmptyState>
        )}
      </Section>
      <Section label="About">
        <Callout label="This app">
          <p>
            Beyond Bot {__APP_VERSION__}, made for bot version 2.x. It talks only to {connection?.url ?? 'your bot'}; this page’s address for BEYONDBOT_API_ORIGINS is <code className="mono">{location.origin}</code>.
          </p>
        </Callout>
      </Section>
    </>
  )
}
