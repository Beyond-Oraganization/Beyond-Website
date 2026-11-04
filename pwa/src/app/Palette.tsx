import { useBot } from '../api/bot.ts'
import { CommandRunner } from '../components/CommandRunner.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { useUi } from '../state/ui.ts'

/** The TUI's ":" command bar: a sheet over any screen, opened with ":" (when not typing). */
export function CommandPalette() {
  const ui = useUi()
  const { ready } = useBot()
  return (
    <Sheet open={ui.paletteOpen && ready} onClose={() => ui.set({ paletteOpen: false })} title="Run a command" wide>
      <CommandRunner autoFocus limit={5} />
    </Sheet>
  )
}
