import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { useAction, useCommand } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd, type Broker, type Mode } from '../api/commands.ts'
import { notices } from '../api/parse/blocks.ts'
import type { TradingAccount } from '../api/parse/accounts.ts'
import { parseStatus } from '../api/parse/status.ts'
import { Answer, FailurePanel } from '../components/Answer.tsx'
import { Segmented, TextField } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ConfirmSheet } from '../components/Sheet.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, EmptyState, Pill, Section } from '../components/ui.tsx'
import { fmtMoney } from '../format.ts'
import { useAccounts } from '../hooks/accounts.ts'

type Tab = 'signin' | 'register' | 'credentials'

/** The credential fields of each broker (Brokers/BrokerFactory.cs). */
const FIELDS: Record<Broker, { key: string; label: string; required: boolean; secret: boolean }[]> = {
  CTrader: [
    { key: 'CLIENT_ID', label: 'Client ID', required: true, secret: false },
    { key: 'CLIENT_SECRET', label: 'Client secret', required: true, secret: true },
    { key: 'ACCESS_TOKEN', label: 'Access token', required: true, secret: true },
    { key: 'REFRESH_TOKEN', label: 'Refresh token', required: false, secret: true },
    { key: 'ACCOUNT_ID', label: 'Account ID', required: true, secret: false },
  ],
  Bybit: [
    { key: 'API_KEY', label: 'API key', required: true, secret: false },
    { key: 'API_SECRET', label: 'API secret', required: true, secret: true },
  ],
}

const BROKER_NOTE: Record<Broker, string> = {
  CTrader: 'A cTrader Open API application (client ID and secret), an access token, and the trader account’s ID.',
  Bybit: 'USDT perpetuals from a unified trading account, in hedge mode (Position mode: Both Sides). Demo keys come from Bybit’s Demo Trading.',
}

const LOGIN_RULE = { value: /^[\w.-]{3,64}$/, message: "3 to 64 letters, digits, '.', '_' or '-'." }
const PASSWORD_RULE = { value: 8, message: 'At least 8 characters.' }

const brokerOf = (name: string | undefined): Broker => (name?.toLowerCase() === 'bybit' ? 'Bybit' : 'CTrader')
const brokerLabel = (broker: string) => (broker.toLowerCase() === 'bybit' ? 'Bybit' : 'cTrader')

type Failure = { message: string; hint: string | null }
const failureOf = (error: unknown): Failure =>
  error instanceof CommandFailure ? { message: error.message, hint: error.hint } : { message: String((error as Error)?.message ?? error), hint: null }

function Outcome({ done, warnings }: { done: string[]; warnings: string[] }) {
  if (!done.length && !warnings.length) return null
  return (
    <Callout label={warnings.length ? 'Done, with a warning' : 'Done'} tone={warnings.length ? 'warn' : undefined}>
      {done.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {warnings.map((line) => (
        <p key={line} className="field-error">
          {line}
        </p>
      ))}
    </Callout>
  )
}

const ModePill = ({ live }: { live: boolean }) => <Pill tone={live ? 'accent' : 'solid'}>{live ? 'LIVE' : 'DEMO'}</Pill>

/** One account of this device's connection, and what can be done with it. */
function AccountCard({ account }: { account: TradingAccount }) {
  const run = useAction()
  const [stopping, setStopping] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (label: string, args: string[], message: string) => {
    setBusy(label)
    try {
      await run(args)
      toast.success(label, message)
    } catch (error) {
      const failure = failureOf(error)
      toast.error(failure.message, failure.hint ?? undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className={account.current ? 'current' : undefined}>
      <div className="card-head">
        <span className="card-title">{account.login}</span>
        <span className="pills">
          {account.current ? <Pill dot>current</Pill> : null}
          <ModePill live={account.live} />
        </span>
      </div>
      <div className="kv">
        <div>
          <span className="k">Broker</span>
          <span className="v">{brokerLabel(account.broker)}</span>
        </div>
        <div>
          <span className="k">Balance</span>
          <span className="v">{account.balance != null ? fmtMoney(account.balance, account.currency) : '–'}</span>
        </div>
        <div>
          <span className="k">Strategies</span>
          <span className="v">{account.strategies} running</span>
        </div>
        <div>
          <span className="k">Account</span>
          <span className="v">{account.accountId ?? '–'}</span>
        </div>
      </div>
      {account.error ? <p className="field-error">{account.error}</p> : null}
      <div className="card-actions">
        {account.current ? null : (
          <Button compact variant="ghost" busy={busy === 'Switched'} onClick={() => void act('Switched', cmd.use(account.login), `Commands now act on ${account.login}.`)}>
            Make current
          </Button>
        )}
        <Button
          compact
          variant="ghost"
          busy={busy === 'Signed out'}
          onClick={() =>
            void act(
              'Signed out',
              cmd.logout(account.login),
              account.strategies ? `${account.login}: its ${account.strategies} strategy session(s) keep trading on the server.` : `${account.login} is signed out on this device.`,
            )
          }
        >
          Sign out
        </Button>
        <Button compact variant="danger" onClick={() => setStopping(true)}>
          Stop trading and sign out
        </Button>
      </div>
      <ConfirmSheet
        open={stopping}
        onClose={() => setStopping(false)}
        title={`Stop ${account.login}?`}
        intro="Its strategies stop after their tick in progress and the bot disconnects the account, for every device signed in to it. Open positions stay open at the broker."
        review={[
          ['Account', `${account.login}, ${brokerLabel(account.broker)} ${account.live ? 'LIVE' : 'DEMO'}`],
          ['Strategies', account.strategies ? `${account.strategies} running: they stop` : 'none running'],
        ]}
        confirmLabel="Stop and sign out"
        danger
        onConfirm={async () => {
          await run(cmd.logout(account.login, true))
          toast.info('Stopped', `${account.login} is stopped and signed out.`)
        }}
      />
    </li>
  )
}

function SignIn({ first }: { first: boolean }) {
  const run = useAction()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [result, setResult] = useState<{ done: string[]; warnings: string[] } | null>(null)
  const { register, handleSubmit, reset, formState } = useForm({ mode: 'onTouched', defaultValues: { login: '', password: '' } })

  const signIn = handleSubmit(async ({ login, password }) => {
    setFailure(null)
    try {
      const answer = await run(cmd.login(login.trim(), password))
      const { done, warnings, other } = notices(answer)
      setResult({ done: [...done, ...other], warnings })
      reset()
      toast.success('Signed in', done[0])
      if (first && !warnings.length) navigate('/')
    } catch (error) {
      setFailure(failureOf(error))
    }
  })

  return (
    <form className="form" noValidate onSubmit={signIn}>
      <p className="p">Unlocks one trading account with its own password. Accounts you signed in to before stay signed in; the newest becomes current.</p>
      <div className="form-grid">
        <TextField id="a-login" label="Login" autoComplete="username" error={formState.errors.login?.message} registration={register('login', { required: 'Enter the login.', pattern: { value: /^[\w.-]+$/, message: "Only letters, digits, '.', '_' and '-'." } })} />
        <TextField id="a-pass" label="Password" type="password" autoComplete="current-password" error={formState.errors.password?.message} registration={register('password', { required: 'Enter the password.' })} />
      </div>
      <div className="btn-row">
        <Button type="submit" busy={formState.isSubmitting}>
          Sign in
        </Button>
      </div>
      {failure ? <FailurePanel failure={failure} /> : null}
      {result ? <Outcome {...result} /> : null}
    </form>
  )
}

function Register({ first }: { first: boolean }) {
  const run = useAction()
  const navigate = useNavigate()
  const [broker, setBroker] = useState<Broker>('CTrader')
  const [mode, setMode] = useState<Mode>('demo')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [done, setDone] = useState<string[] | null>(null)
  const [confirmLive, setConfirmLive] = useState<Record<string, string> | null>(null)
  const { register, handleSubmit, reset, formState } = useForm<Record<string, string>>({ mode: 'onTouched' })
  const errors = formState.errors as Record<string, { message?: string } | undefined>

  const create = async (values: Record<string, string>) => {
    setFailure(null)
    const login = (values.login ?? '').trim()
    const credentials = FIELDS[broker].map((field) => [field.key, (values[field.key] ?? '').trim()] as [string, string]).filter(([, value]) => value)
    try {
      const registered = await run(cmd.register(login, values.password ?? '', broker, mode, credentials))
      // Then signs in with the same login and password, as a person would.
      const signedIn = await run(cmd.login(login, values.password ?? ''))
      setDone([...notices(registered).done, ...notices(signedIn).done])
      reset()
      toast.success('Account created', `Signed in to ${login}.`)
      if (first) navigate('/')
    } catch (error) {
      setFailure(failureOf(error))
    }
  }

  return (
    <form className="form" noValidate onSubmit={handleSubmit((values) => (mode === 'live' ? setConfirmLive(values) : create(values)))}>
      <p className="p">A new trading account: a unique login, its password, and one broker’s keys. The bot stores the keys encrypted with the password (AES-256-GCM); this app sends them once and keeps nothing.</p>
      <div className="form-grid">
        <TextField id="r-login" label="New login" autoComplete="username" hint="Unique, and it cannot be changed later." error={errors.login?.message} registration={register('login', { required: 'Choose a login.', pattern: LOGIN_RULE })} />
        <TextField id="r-pass" label="Password" type="password" autoComplete="new-password" error={errors.password?.message} registration={register('password', { required: 'Choose a password.', minLength: PASSWORD_RULE })} />
        <TextField id="r-confirm" label="Password again" type="password" autoComplete="new-password" error={errors.confirm?.message} registration={register('confirm', { validate: (value, all) => value === all.password || 'The two passwords differ.' })} />
      </div>
      <Segmented
        name="r-broker"
        legend="Broker"
        value={broker}
        onChange={setBroker}
        hint={BROKER_NOTE[broker]}
        options={[
          { value: 'CTrader', label: 'cTrader' },
          { value: 'Bybit', label: 'Bybit' },
        ]}
      />
      <div className="form-grid">
        {FIELDS[broker].map((field) => (
          <TextField
            key={`${broker}-${field.key}`}
            id={`r-${field.key}`}
            label={`${field.label}${field.required ? '' : ' (optional)'}`}
            type={field.secret ? 'password' : 'text'}
            mono
            inputMode={field.key === 'ACCOUNT_ID' ? 'numeric' : undefined}
            error={errors[field.key]?.message}
            registration={register(field.key, {
              required: field.required ? `${field.label} is required.` : false,
              ...(field.key === 'ACCOUNT_ID' ? { pattern: { value: /^\d+$/, message: 'The account ID is a number.' } } : {}),
            })}
          />
        ))}
      </div>
      <Segmented
        name="r-mode"
        legend="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'demo', label: 'Demo' },
          { value: 'live', label: 'Live' },
        ]}
      />
      {mode === 'live' ? (
        <Callout label="Real money" tone="error">
          <p>A Live account trades real money. Every strategy you start on it asks again.</p>
        </Callout>
      ) : null}
      <div className="btn-row">
        <Button type="submit" variant={mode === 'live' ? 'danger' : 'solid'} busy={formState.isSubmitting}>
          {mode === 'live' ? 'Create a LIVE account' : 'Create the account'}
        </Button>
      </div>
      {failure ? <FailurePanel failure={failure} /> : null}
      {done ? <Outcome done={done} warnings={[]} /> : null}
      <ConfirmSheet
        open={confirmLive !== null}
        onClose={() => setConfirmLive(null)}
        title="Create a LIVE account?"
        intro="Its strategies trade real money on the broker."
        review={[
          ['Login', (confirmLive?.login ?? '').trim()],
          ['Broker', `${brokerLabel(broker)} LIVE`],
        ]}
        confirmLabel="Create the LIVE account"
        danger
        onConfirm={async () => {
          if (confirmLive) await create(confirmLive)
        }}
      />
    </form>
  )
}

function Credentials({ account }: { account: TradingAccount }) {
  const run = useAction()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [result, setResult] = useState<{ done: string[]; warnings: string[] } | null>(null)
  const { register, handleSubmit, reset, formState } = useForm<Record<string, string>>({ mode: 'onTouched' })
  const errors = formState.errors as Record<string, { message?: string } | undefined>
  const broker = brokerOf(account.broker)

  const submit = handleSubmit(async (values) => {
    setFailure(null)
    const credentials = FIELDS[broker].map((field) => [field.key, (values[field.key] ?? '').trim()] as [string, string]).filter(([, value]) => value)
    try {
      const answer = await run(cmd.credentials(values.current ?? '', values.next ? values.next : null, credentials), { account: account.login })
      const { done, warnings, other } = notices(answer)
      setResult({ done: [...done, ...other], warnings })
      reset()
    } catch (error) {
      setFailure(failureOf(error))
    }
  })

  return (
    <form className="form" noValidate onSubmit={submit}>
      <p className="p">
        Change the password or the {brokerLabel(broker)} keys of <b>{account.login}</b>. Fields left empty keep their stored values. If the account trades or is open on another device, the new keys take effect when it is next opened.
      </p>
      <div className="form-grid">
        <TextField id="k-current" label="Current password" type="password" autoComplete="current-password" error={errors.current?.message} registration={register('current', { required: 'The current password is needed.' })} />
        <TextField id="k-next" label="New password (optional)" type="password" autoComplete="new-password" error={errors.next?.message} registration={register('next', { validate: (value) => !value || value.length >= 8 || PASSWORD_RULE.message })} />
        <TextField id="k-confirm" label="New password again" type="password" autoComplete="new-password" error={errors.confirm?.message} registration={register('confirm', { validate: (value, all) => !all.next || value === all.next || 'The two passwords differ.' })} />
      </div>
      <div className="form-grid">
        {FIELDS[broker].map((field) => (
          <TextField key={field.key} id={`k-${field.key}`} label={`${field.label} (optional)`} type={field.secret ? 'password' : 'text'} mono registration={register(field.key)} />
        ))}
      </div>
      <div className="btn-row">
        <Button type="submit" busy={formState.isSubmitting}>
          Save
        </Button>
      </div>
      {failure ? <FailurePanel failure={failure} /> : null}
      {result ? <Outcome {...result} /> : null}
    </form>
  )
}

/** A bot from before accounts: one login for every client, shown as `status` reports it. */
function LegacyBot() {
  const status = useCommand('status', cmd.status(), parseStatus, { accept: [1] })
  return (
    <Callout label="An older bot" tone="warn">
      <p>This bot predates trading accounts: it has one login for every client. Update it to sign in to several accounts from this app.</p>
      <Answer query={status} lines={2}>
        {(value) => (
          <dl className="dl">
            <dt>User</dt>
            <dd>{value.user ?? 'not logged in'}</dd>
            <dt>Broker</dt>
            <dd>{value.broker.text}</dd>
          </dl>
        )}
      </Answer>
    </Callout>
  )
}

export default function Account() {
  const { query, accounts, current, legacy } = useAccounts()
  const [tab, setTab] = useState<Tab>('signin')
  const first = accounts.length === 0
  const shown = tab === 'credentials' && !current ? 'signin' : tab

  return (
    <>
      <ScreenHead
        kicker="Trading accounts"
        title={current ? `Trading as ${current.login}.` : 'Add a trading account.'}
        lead="Each account unlocks one broker account, Demo or Live, with its own password. This device can hold several at once; markets and backtests work without any."
        crumbs={[{ label: 'Session', to: '/' }, { label: 'Trading accounts' }]}
      />
      <Section label="Your accounts">
        {legacy ? (
          <LegacyBot />
        ) : query.isPending ? (
          <p className="p">Asking the bot…</p>
        ) : query.error ? (
          <FailurePanel failure={{ message: query.error.message, hint: query.error.hint }} onRetry={() => void query.refetch()} />
        ) : first ? (
          <EmptyState title="No trading account on this device yet.">
            <p className="p">Sign in to an account, or create one below. Strategies the server started stay out of reach until you sign in to their account.</p>
          </EmptyState>
        ) : (
          <ul className="cards accounts" aria-label="Trading accounts">
            {accounts.map((account) => (
              <AccountCard key={account.login} account={account} />
            ))}
          </ul>
        )}
      </Section>
      <Section variant="alt" label="Add or change an account">
        <div className="tabs">
          <Segmented
            name="account-tab"
            legend="What to do"
            value={shown}
            onChange={setTab}
            options={[
              { value: 'signin', label: first ? 'Sign in' : 'Add another account' },
              { value: 'register', label: 'Create an account' },
              { value: 'credentials', label: 'Change password or keys', disabled: !current },
            ]}
          />
        </div>
        {shown === 'signin' ? <SignIn first={first} /> : shown === 'register' ? <Register first={first} /> : current ? <Credentials account={current} /> : null}
      </Section>
    </>
  )
}
