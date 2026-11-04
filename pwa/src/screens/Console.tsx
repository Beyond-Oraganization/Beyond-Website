import { CommandRunner } from '../components/CommandRunner.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { Section } from '../components/ui.tsx'

export default function Console() {
  return (
    <>
      <ScreenHead
        kicker="Console"
        title="Any command."
        lead="Every bot command works here, as in its terminal and its TUI’s command bar. Press : anywhere in the app to open it in a sheet."
      />
      <Section variant="alt" label="Console">
        <CommandRunner autoFocus limit={50} />
      </Section>
    </>
  )
}
