import { ScreenHead } from '../components/ScreenHead.tsx'
import { Section } from '../components/ui.tsx'
import { InstallHelp } from '../install/InstallHelp.tsx'

export default function Install() {
  return (
    <>
      <ScreenHead kicker="Install" title="Put Beyond Bot on this device." lead="Its own icon and window, a start without the network, updates in place. No app store." />
      <Section variant="alt">
        <div style={{ maxWidth: '44em' }}>
          <InstallHelp />
        </div>
      </Section>
    </>
  )
}
