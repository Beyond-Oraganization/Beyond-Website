import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { useAction, useCommand } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import { notices } from '../api/parse/blocks.ts'
import { parseStatus } from '../api/parse/status.ts'
import { Answer, FailurePanel } from '../components/Answer.tsx'
import { Segmented, TextField } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ConfirmSheet } from '../components/Sheet.tsx'
import { toast } from '../components/Toasts.tsx'
import { Button, Callout, Section } from '../components/ui.tsx'
import { useSessionData } from '../hooks/session.ts'

type Tab = 'signin' | 'register' | 'credentials' | 'logout'

/** The broker credential fields of cTrader, the bot's active broker (Brokers/BrokerFactory.cs). */
const CTRADER = [
  { key: 'CLIENT_ID', label: 'Client ID', required: true, secret: false },
  { key: 'CLIENT_SECRET', label: 'Client secret', required: true, secret: true },
  { key: 'ACCESS_TOKEN', label: 'Access token', required: true, secret: true },
  { key: 'REFRESH_TOKEN', label: 'Refresh token', required: false, secret: true },
  { key: 'ACCOUNT_ID', label: 'Account ID', required: true, secret: false },
] as const

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

function SignIn({ trading }: { trading: number }) {
  const run = useAction()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [result, setResult] = useState<{ done: string[]; warnings: string[] } | null>(null)
  const [pending, setPending] = useState<{ login: string; password: string } | null>(null)
  const { register, handleSubmit, reset, formState } = useForm({ mode: 'onTouched', defaultValues: { login: '', password: '' } })

  const signIn = async ({ login, password }: { login: string; password: string }) => {
    setFailure(null)
    try {
      const answer = await run(cmd.login(login.trim(), password), { invalidate: ['status'] })
      const { done, warnings, other } = notices(answer)
      setResult({ done: [...done, ...other], warnings })
      reset()
      toast.success('Signed in', done[0])
      if (!warnings.length) navigate('/')
    } catch (error) {
      setFailure(failureOf(error))
    }
  }

  return (
    <form
      className="form"
      noValidate
      onSubmit={handleSubmit((values) => (trading ? setPending(values) : signIn(values)))}
    >
      <p className="p">The bot signs in with one of its logins and connects to the broker with that login’s stored credentials.</p>
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
      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Signing in stops trading"
        intro={`The bot is trading ${trading} strategy session(s). Signing in again stops all of them first, after their tick in progress.`}
        confirmLabel="Stop them and sign in"
        danger
        onConfirm={async () => {
          if (pending) await signIn(pending)
        }}
      />
    </form>
  )
}

function Register() {
  const run = useAction()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [done, setDone] = useState<string[] | null>(null)
  const { register, handleSubmit, reset, formState } = useForm<Record<string, string | boolean>>({ mode: 'onTouched' })
  const errors = formState.errors as Record<string, { message?: string } | undefined>

  const submit = handleSubmit(async (values) => {
    setFailure(null)
    const credentials = CTRADER.map((field) => [field.key, String(values[field.key] ?? '').trim()] as [string, string]).filter(([, value]) => value)
    try {
      const answer = await run(cmd.register(String(values.login).trim(), String(values.password), credentials, Boolean(values.force)))
      setDone(notices(answer).done)
      reset()
    } catch (error) {
      setFailure(failureOf(error))
    }
  })

  return (
    <form className="form" noValidate onSubmit={submit}>
      <p className="p">A new login, with its cTrader Open API credentials. The bot stores them encrypted on the server (AES-256-GCM); this app sends them once and keeps nothing.</p>
      <div className="form-grid">
        <TextField id="r-login" label="New login" autoComplete="username" error={errors.login?.message} registration={register('login', { required: 'Choose a login.', pattern: { value: /^[\w.-]+$/, message: "Only letters, digits, '.', '_' and '-'." } })} />
        <TextField id="r-pass" label="Password" type="password" autoComplete="new-password" error={errors.password?.message} registration={register('password', { required: 'Choose a password.' })} />
        <TextField id="r-confirm" label="Password again" type="password" autoComplete="new-password" error={errors.confirm?.message} registration={register('confirm', { validate: (value, all) => value === all.password || 'The two passwords differ.' })} />
      </div>
      <div className="form-grid">
        {CTRADER.map((field) => (
          <TextField
            key={field.key}
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
      <label className="check">
        <input type="checkbox" {...register('force')} /> Replace a login with the same name
      </label>
      <div className="btn-row">
        <Button type="submit" busy={formState.isSubmitting}>
          Create the login
        </Button>
      </div>
      {failure ? <FailurePanel failure={failure} /> : null}
      {done ? <Outcome done={done} warnings={[]} /> : null}
    </form>
  )
}

function Credentials() {
  const run = useAction()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [result, setResult] = useState<{ done: string[]; warnings: string[] } | null>(null)
  const { register, handleSubmit, reset, formState } = useForm<Record<string, string>>({ mode: 'onTouched' })
  const errors = formState.errors as Record<string, { message?: string } | undefined>

  const submit = handleSubmit(async (values) => {
    setFailure(null)
    const credentials = CTRADER.map((field) => [field.key, (values[field.key] ?? '').trim()] as [string, string]).filter(([, value]) => value)
    try {
      const answer = await run(cmd.credentials(values.current ?? '', values.next ? values.next : null, credentials), { invalidate: ['status'] })
      const { done, warnings, other } = notices(answer)
      setResult({ done: [...done, ...other], warnings })
      reset()
    } catch (error) {
      setFailure(failureOf(error))
    }
  })

  return (
    <form className="form" noValidate onSubmit={submit}>
      <p className="p">Change the signed-in login’s password, or some of its broker credentials. Fields left empty keep their stored values.</p>
      <div className="form-grid">
        <TextField id="k-current" label="Current password" type="password" autoComplete="current-password" error={errors.current?.message} registration={register('current', { required: 'The current password is needed.' })} />
        <TextField id="k-next" label="New password (optional)" type="password" autoComplete="new-password" registration={register('next')} />
        <TextField id="k-confirm" label="New password again" type="password" autoComplete="new-password" error={errors.confirm?.message} registration={register('confirm', { validate: (value, all) => !all.next || value === all.next || 'The two passwords differ.' })} />
      </div>
      <div className="form-grid">
        {CTRADER.map((field) => (
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

function LogOut({ trading }: { trading: number }) {
  const run = useAction()
  const [open, setOpen] = useState(false)
  return (
    <div className="stack">
      <p className="p">
        Logging the bot out stops every strategy (after its tick in progress) and disconnects the broker. Trading resumes only after someone signs it in again. This is not the same as disconnecting this app: for that, use Connections.
      </p>
      <div className="btn-row">
        <Button variant="danger" onClick={() => setOpen(true)}>
          Log the bot out
        </Button>
      </div>
      <ConfirmSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Log the bot out?"
        review={[
          ['Strategies', trading ? `${trading} running: they stop` : 'none running'],
          ['Broker', 'disconnects'],
        ]}
        confirmLabel="Log out"
        danger
        onConfirm={async () => {
          const answer = await run(cmd.logout(), { invalidate: ['status'] })
          toast.info('Logged out', notices(answer).done[0] ?? 'The bot is signed out.')
        }}
      />
    </div>
  )
}

export default function Account() {
  const status = useCommand('status', cmd.status(), parseStatus, { accept: [1] })
  const session = useSessionData()
  const trading = session.data?.parsed.ok ? session.data.parsed.value.strategies.length : status.data?.parsed.ok ? status.data.parsed.value.trading : 0
  const signedIn = status.data?.parsed.ok ? status.data.parsed.value.user : null
  const [tab, setTab] = useState<Tab>(signedIn ? 'credentials' : 'signin')

  return (
    <>
      <ScreenHead
        kicker="Bot account"
        title={signedIn ? `Signed in as ${signedIn}.` : 'Sign the bot in.'}
        lead="The bot’s own logins: which one is signed in, and its broker credentials."
        crumbs={[{ label: 'Session', to: '/' }, { label: 'Bot account' }]}
      >
        <Answer query={status} lines={2}>
          {(value) => (
            <dl className="dl">
              <dt>User</dt>
              <dd>{value.user ?? 'not logged in'}</dd>
              <dt>Broker</dt>
              <dd>{value.broker.text}</dd>
              <dt>Trading</dt>
              <dd>{value.trading} strategy session(s)</dd>
            </dl>
          )}
        </Answer>
      </ScreenHead>
      <Section variant="alt" label="Account actions">
        <div className="tabs">
          <Segmented
            name="account-tab"
            legend="What to do"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'register', label: 'Create a login' },
              { value: 'credentials', label: 'Change credentials', disabled: !signedIn },
              { value: 'logout', label: 'Log out', disabled: !signedIn },
            ]}
          />
        </div>
        {tab === 'signin' ? <SignIn trading={trading} /> : tab === 'register' ? <Register /> : tab === 'credentials' ? <Credentials /> : <LogOut trading={trading} />}
      </Section>
    </>
  )
}
