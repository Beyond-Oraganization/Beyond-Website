import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { explain, runCommand, type Outcome } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import { parseStatus, type StatusReading } from '../api/parse/status.ts'
import { Segmented, TextField } from '../components/Field.tsx'
import { Icon } from '../components/Icon.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, Section } from '../components/ui.tsx'
import { useInstall } from '../install/install.ts'
import { normalizeUrl, useConnections, type KeyStorage } from '../state/connections.ts'
import { useUi } from '../state/ui.ts'
import { passphraseProblem, strength } from '../state/vault.ts'

type Values = { name: string; url: string; key: string; passphrase: string; confirm: string }

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied', text)
  } catch {
    toast.error('Could not copy', text)
  }
}

const isLoopback = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url)
const isPrivate = (url: string) => /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url)

/** What to check when the bot cannot be reached: the bot README's setup, in order. */
export function Unreachable({ url }: { url: string }) {
  const origin = location.origin
  return (
    <Callout label="The bot cannot be reached" tone="error">
      <p>The browser could not talk to {url}. It does not say why, so check these in order:</p>
      <ol className="checks">
        <li>
          <span>
            <strong>Trust the bot’s certificate on this device.</strong> It is self-signed. Quick check: open{' '}
            <a className="underline" href={url} target="_blank" rel="noopener noreferrer">
              the bot’s address
            </a>{' '}
            in a new tab, accept the warning (the page then shows an error: that is expected) and come back. To make it last, install <code className="mono">api-cert.pem</code> as trusted, as the bot README describes for macOS,
            Windows, iOS (a profile, then full trust) and Android (CA certificate).
          </span>
        </li>
        <li>
          <span>
            <strong>Allow this page’s address.</strong> On the server, <code className="mono">/etc/beyondbot.env</code> needs{' '}
            <code className="mono">BEYONDBOT_API_ORIGINS={origin}</code>, then <code className="mono">sudo systemctl restart beyondbot</code>.{' '}
            <button type="button" className="link" onClick={() => void copy(`BEYONDBOT_API_ORIGINS=${origin}`)}>
              Copy the line
            </button>
          </span>
        </li>
        <li>
          <span>
            <strong>Open the firewall.</strong> TCP 8443 from your IP (the VPC firewall rule <code className="mono">beyondbot-api</code>, and <code className="mono">ufw allow 8443/tcp</code> if the VM runs ufw).
          </span>
        </li>
        <li>
          <span>
            <strong>Check the bot runs <code className="mono">serve</code>.</strong> <code className="mono">journalctl -u beyondbot -f</code> should show “The command API listens on https://0.0.0.0:8443”.
          </span>
        </li>
        {isLoopback(url) || isPrivate(url) ? (
          <li>
            <span>
              <strong>A local address.</strong> Through an SSH tunnel (<code className="mono">gcloud compute ssh &lt;vm&gt; -- -L 8443:localhost:8443</code>) use{' '}
              <code className="mono">http://localhost:8443</code>. Chrome may ask to let this page reach apps on this device or network: allow it.
            </span>
          </li>
        ) : null}
      </ol>
    </Callout>
  )
}

function Checked({ status, onDone }: { status: StatusReading | null; onDone: () => void }) {
  return (
    <Callout label="Connected">
      {status ? (
        <dl className="dl">
          <dt>Version</dt>
          <dd>{status.version ?? '–'}</dd>
          <dt>Database</dt>
          <dd>{status.database.text}</dd>
          <dt>Trading account</dt>
          <dd>{status.user ?? 'none yet on this device'}</dd>
          <dt>Broker</dt>
          <dd>{status.broker.text}</dd>
          <dt>Trading</dt>
          <dd>{status.trading} strategy session(s)</dd>
        </dl>
      ) : (
        <p>The bot answered.</p>
      )}
      <div className="btn-row">
        {status && !status.user ? (
          <Link to="/account" className="btn btn-solid" onClick={onDone}>
            Add a trading account
          </Link>
        ) : (
          <Link to="/" className="btn btn-solid" onClick={onDone}>
            Open the session
          </Link>
        )}
      </div>
    </Callout>
  )
}

export default function Connect() {
  const { offerable, standalone, platform } = useInstall()
  const ui = useUi()
  const add = useConnections((state) => state.add)
  const navigate = useNavigate()
  const [skipInstall, setSkipInstall] = useState(false)
  // Remember me keeps the key with the device key; otherwise a passphrase seals it, or it is not kept at all.
  const [remember, setRemember] = useState(false)
  const [kept, setKept] = useState<Exclude<KeyStorage, 'device'>>('passphrase')
  const storage: KeyStorage = remember ? 'device' : kept
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [status, setStatus] = useState<StatusReading | null>(null)
  const [connected, setConnected] = useState(false)
  const ios = platform === 'ios-safari' || platform === 'ios-other'
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ mode: 'onTouched', defaultValues: { name: '', url: '', key: '', passphrase: '', confirm: '' } })
  const passphrase = useWatch({ control, name: 'passphrase' })
  const typedUrl = useWatch({ control, name: 'url' })

  const submit = async (values: Values) => {
    setOutcome(null)
    let url: string
    try {
      url = normalizeUrl(values.url)
    } catch {
      return setError('url', { message: 'Enter the bot’s address, like https://203.0.113.10:8443.' })
    }
    if (url.startsWith('http://') && !isLoopback(url)) return setError('url', { message: 'Use https:// (only a tunnel on this device may use http://).' })
    const result = await runCommand({ url, key: values.key.trim() }, cmd.status())
    setOutcome(result)
    if (result.kind === 'unauthorized') return setError('key', { message: 'The bot refused this key.' })
    if (!('result' in result)) return
    const reading = parseStatus(result.result)
    setStatus(reading.ok ? reading.value : null)
    await add({ name: values.name, url, key: values.key, storage, passphrase: storage === 'passphrase' ? values.passphrase : undefined })
    setConnected(true)
    toast.success('Connected', `${values.name || new URL(url).host} is saved on this device.`)
  }

  const showInstall = offerable && !standalone && !skipInstall && !connected
  const explained = outcome && outcome.kind !== 'ok' && outcome.kind !== 'unauthorized' && outcome.kind !== 'unreachable' && !('result' in outcome) ? explain(outcome) : null

  return (
    <>
      <ScreenHead kicker="Connect" title="Connect your bot." lead="Beyond Bot talks to your bot’s HTTPS command API: the address of the server running beyondbot serve, and its API key." />
      {showInstall ? (
        <Section variant="dark" label="Install first">
          <div className="stack" style={{ maxWidth: '44em' }}>
            <p className="h2">Install the app first?</p>
            <p className="lead on-band">
              {ios
                ? 'On iPhone and iPad the installed app keeps its own storage, apart from Safari: install it first, then connect inside it.'
                : 'Then Beyond Bot opens from your home screen or app list, in its own window, even offline.'}
            </p>
            <div className="btn-row">
              <Button icon="install" onClick={() => ui.set({ installOpen: true })}>
                Install the app
              </Button>
              <Button variant="ghost" onClick={() => setSkipInstall(true)}>
                Continue in the browser
              </Button>
            </div>
          </div>
        </Section>
      ) : null}
      <Section variant="alt" label="Bot details">
        {connected ? (
          <Checked status={status} onDone={() => navigate('/')} />
        ) : (
          <form className="form" noValidate onSubmit={handleSubmit(submit)}>
            <TextField
              id="c-url"
              label="Address"
              hint="The server and port, e.g. https://203.0.113.10:8443. On a Google Cloud VM this is its static IP."
              error={errors.url?.message}
              inputMode="url"
              autoComplete="url"
              placeholder="https://203.0.113.10:8443"
              registration={register('url', { required: 'Enter the bot’s address.' })}
            />
            <TextField
              id="c-key"
              label="API key"
              type="password"
              mono
              hint="On the server: sudo cat /etc/beyondbot/api-key. It controls everything the bot can do."
              error={errors.key?.message}
              registration={register('key', { required: 'Paste the API key.', validate: (value) => value.trim().length >= 32 || 'The API key has at least 32 characters.' })}
            />
            <TextField id="c-name" label="Name (optional)" hint="Shown in the header, e.g. “Gold VM”." registration={register('name')} />
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember me on this device
              </label>
              <p className="hint">
                {remember
                  ? 'The app opens straight to the bot, without a passphrase. The key is encrypted with a key of this device only; other pages on beyond-oraganization.github.io could still use it, so choose this only on a device that is yours alone. “Lock the bot” (in More) locks it whenever you want.'
                  : 'Without it, the key is kept under a passphrase you type when the app starts or after it locks, or not kept at all.'}
              </p>
            </div>
            {remember ? null : (
              <Segmented
                name="storage"
                legend="Keep the key on this device"
                value={kept}
                onChange={setKept}
                options={[
                  { value: 'passphrase', label: 'With a passphrase' },
                  { value: 'session', label: 'Don’t keep it' },
                ]}
                hint={kept === 'passphrase' ? 'The key is encrypted; you type the passphrase when the app starts or after it locks.' : 'You paste the key every time you open the app.'}
              />
            )}
            {storage === 'passphrase' ? (
              <div className="form-grid">
                <TextField
                  id="c-pass"
                  label="Passphrase"
                  type="password"
                  autoComplete="new-password"
                  hint={passphrase ? `Strength: ${strength(passphrase)}.` : 'At least 8 characters; a few words work well.'}
                  error={errors.passphrase?.message}
                  registration={register('passphrase', { validate: (value) => passphraseProblem(value) ?? true })}
                />
                <TextField
                  id="c-confirm"
                  label="Passphrase again"
                  type="password"
                  autoComplete="new-password"
                  error={errors.confirm?.message}
                  registration={register('confirm', { validate: (value, all) => value === all.passphrase || 'The two passphrases differ.' })}
                />
              </div>
            ) : null}
            <div className="btn-row">
              <Button type="submit" busy={isSubmitting} icon="plug">
                Check and connect
              </Button>
            </div>
            {outcome?.kind === 'unreachable' ? <Unreachable url={typedUrl.trim()} /> : null}
            {explained ? (
              <Callout label="That did not work" tone="error">
                <p>{explained.message}</p>
                {explained.hint ? <p className="hint">{explained.hint}</p> : null}
              </Callout>
            ) : null}
          </form>
        )}
      </Section>
      <Section label="Where the key comes from">
        <div className="cols2">
          <div className="stack-sm">
            <p className="label mute">On the server</p>
            <p className="p">
              The bot README’s “HTTP API” section sets up the key (<code className="mono">openssl rand -hex 32</code>), the certificate for the server’s IP, and the firewall rule. This app adds one line to <code className="mono">/etc/beyondbot.env</code>:
            </p>
            <p>
              <code className="mono">BEYONDBOT_API_ORIGINS={location.origin}</code>{' '}
              <button type="button" className="link" onClick={() => void copy(`BEYONDBOT_API_ORIGINS=${location.origin}`)}>
                Copy
              </button>
            </p>
          </div>
          <div className="stack-sm">
            <p className="label mute">On this device</p>
            <p className="p">
              Nothing leaves this device except the commands you send to your bot. <Icon name="lock" /> The key is sealed as you choose above; bot passwords and broker credentials are never stored.
            </p>
          </div>
        </div>
      </Section>
    </>
  )
}
