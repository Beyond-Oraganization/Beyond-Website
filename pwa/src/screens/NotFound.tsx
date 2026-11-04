import { Link, useRouteError } from 'react-router'
import { Section } from '../components/ui.tsx'
import { useTitle } from '../hooks/env.ts'

export function NotFound() {
  useTitle('Not found')
  return (
    <Section ruled labelledBy="nf-title">
      <p className="kicker">Error 404</p>
      <h1 className="title" id="nf-title">
        This door leads nowhere.
      </h1>
      <p className="lead" style={{ marginTop: 16 }}>
        The screen you asked for does not exist in Beyond Bot.
      </p>
      <div className="btn-row" style={{ marginTop: 32 }}>
        <Link to="/" className="btn btn-solid">
          Back to the session
        </Link>
        <Link to="/console" className="btn btn-ghost">
          Open the console
        </Link>
      </div>
    </Section>
  )
}

/** Shown if a screen fails to draw: the error, and a way back. */
export function Crashed() {
  const error = useRouteError() as Error | undefined
  return (
    <div className="page">
      <section className="sec dark" aria-labelledby="crash-title">
        <div className="wrap">
          <p className="kicker">Something broke</p>
          <h1 className="title" id="crash-title">
            This screen could not be drawn.
          </h1>
          <p className="lead on-band" style={{ marginTop: 16 }}>
            Your bot is not affected: nothing was sent to it. Reloading usually helps.
          </p>
          {error?.message ? <pre className="block-text" style={{ marginTop: 24 }}>{error.message}</pre> : null}
          <div className="btn-row" style={{ marginTop: 28 }}>
            <button type="button" className="btn btn-solid" onClick={() => location.reload()}>
              Reload
            </button>
            <a href="#/" className="btn btn-ghost">
              Back to the session
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
