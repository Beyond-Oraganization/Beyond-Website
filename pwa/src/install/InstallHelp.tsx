import { useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import { Button, Callout } from '../components/ui.tsx'
import { toast } from '../components/Toasts.tsx'
import { promptInstall, useInstall, type Platform } from './install.ts'

const Key = ({ children }: { children: ReactNode }) => <strong className="chip">{children}</strong>

function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="checks">
      {steps.map((step, index) => (
        <li key={index}>
          <span>
            <span className="vh">Step {index + 1}: </span>
            {step}
          </span>
        </li>
      ))}
    </ol>
  )
}

const SEPARATE_STORAGE = (
  <Callout label="Install first, then connect">
    <p>An app on the Home Screen has its own storage, separate from Safari. Install it before you connect your bot, or connect again inside the installed app.</p>
  </Callout>
)

/** The steps for this browser, drawn in the website's style. Exported for tests. */
export function stepsFor(platform: Platform): { intro: string; steps: ReactNode[]; note?: ReactNode; canInstall: boolean } {
  switch (platform) {
    case 'ios-safari':
      return {
        intro: 'iPhone and iPad install from the Share menu.',
        steps: [
          <>Tap <Key><Icon name="share" /> Share</Key> in Safari's toolbar.</>,
          <>Scroll down and tap <Key><Icon name="addsquare" /> Add to Home Screen</Key>.</>,
          <>Keep <Key>Open as Web App</Key> on, then tap <Key>Add</Key>.</>,
        ],
        note: SEPARATE_STORAGE,
        canInstall: true,
      }
    case 'ios-other':
      return {
        intro: 'iPhone and iPad install from the Share menu, in Safari or in this browser (iOS 16.4 and later).',
        steps: [
          <>Tap <Key><Icon name="share" /> Share</Key>: in Chrome it is in the address bar; in Edge and Firefox open the menu first.</>,
          <>Tap <Key><Icon name="addsquare" /> Add to Home Screen</Key>.</>,
          <>Tap <Key>Add</Key>.</>,
        ],
        note: SEPARATE_STORAGE,
        canInstall: true,
      }
    case 'mac-safari':
      return {
        intro: 'Safari 17 and later add web apps to the Dock.',
        steps: [<>Choose <Key>File</Key> → <Key>Add to Dock…</Key> (or Share → Add to Dock).</>, <>Click <Key>Add</Key>. The app opens in its own window.</>],
        canInstall: true,
      }
    case 'android-firefox':
      return {
        intro: 'Firefox installs from its menu.',
        steps: [<>Tap the menu <Key>⋮</Key>.</>, <>Tap <Key><Icon name="install" /> Install</Key> (or Add app to Home screen).</>],
        canInstall: true,
      }
    case 'chromium':
      return {
        intro: 'Your browser can install the app. If its own dialog did not open, use its menu:',
        steps: [
          <>On a computer: the <Key><Icon name="install" /> install</Key> icon at the right of the address bar, or the menu's <Key>Install Beyond Bot</Key> item.</>,
          <>On Android: the menu <Key>⋮</Key> → <Key>Install app</Key> (or Add to Home screen).</>,
        ],
        canInstall: true,
      }
    case 'desktop-firefox':
      return {
        intro: 'Firefox on computers cannot install web apps yet: its web-app feature is experimental and Windows-only.',
        steps: [<>Open this address in <Key>Chrome</Key>, <Key>Edge</Key> or <Key>Safari</Key> and install it there.</>],
        canInstall: false,
      }
    case 'in-app':
      return {
        intro: "This is another app's built-in browser, which cannot install apps.",
        steps: [<>Open this address in your browser: Chrome, Safari, Edge or Samsung Internet.</>, <>Install it there.</>],
        canInstall: false,
      }
    default:
      return {
        intro: 'Open this address in Chrome, Edge or Safari to install it.',
        steps: [<>Chrome and Edge install from the address bar or their menu; Safari from Share → Add to Home Screen (iPhone, iPad) or File → Add to Dock (Mac).</>],
        canInstall: false,
      }
  }
}

/** Install help: the browser's own dialog where there is one, otherwise the steps for this browser. */
export function InstallHelp() {
  const { platform, canPrompt, standalone } = useInstall()
  const [asking, setAsking] = useState(false)
  const help = stepsFor(platform)

  if (standalone) {
    return (
      <Callout label="Installed">
        <p>You are using the installed app. To remove it, uninstall it like any other app on this device; first use “Forget this bot” in Connections to erase the stored key.</p>
      </Callout>
    )
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href.split('#')[0] ?? location.href)
      toast.success('Link copied', 'Paste it into your browser.')
    } catch {
      toast.error('Could not copy', location.href)
    }
  }

  return (
    <div className="stack">
      {canPrompt ? (
        <div className="stack-sm">
          <p className="p">Install Beyond Bot to get its own icon and window, start it offline and update it in place.</p>
          <div className="btn-row">
            <Button
              icon="install"
              busy={asking}
              onClick={async () => {
                setAsking(true)
                const outcome = await promptInstall().finally(() => setAsking(false))
                if (outcome === 'dismissed') toast.info('Not installed', 'You can install it later from Settings.')
              }}
            >
              Install Beyond Bot
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="p">{help.intro}</p>
          <Steps steps={help.steps} />
          {help.note}
          {!help.canInstall ? (
            <div className="btn-row">
              <Button variant="ghost" icon="copy" onClick={copyLink}>
                Copy link
              </Button>
            </div>
          ) : null}
        </>
      )}
      <p className="hint">Installing the app does not install your bot's certificate: each device still trusts it once (see Connect).</p>
    </div>
  )
}
