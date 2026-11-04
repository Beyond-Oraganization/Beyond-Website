import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/fonts.css'
import './styles/base.css'
import './styles/app.css'
import { App } from './App.tsx'
import { toast } from './components/Toasts.tsx'
import { startInstallWatch } from './install/install.ts'
import { useConnections } from './state/connections.ts'
import { persistStorage } from './state/db.ts'
import { useSettings } from './state/settings.ts'
import { watchSystemTheme } from './theme.ts'

// Inside another page's frame the app would not be what it seems: show nothing there.
if (window.top !== window.self) {
  document.body.textContent = 'Beyond Bot cannot run inside a frame.'
} else {
  startInstallWatch(() => toast.success('Installed', 'Open Beyond Bot from your home screen or app list.'))
  watchSystemTheme()
  void useSettings.getState().load()
  void useConnections.getState().load()
  void persistStorage()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
