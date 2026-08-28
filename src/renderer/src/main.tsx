import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RendererErrorBoundary } from './components/RendererErrorBoundary'
import { watchSystemColorScheme } from './systemColorScheme'

const platform = navigator.platform.toLocaleLowerCase()
document.documentElement.dataset.platform = platform.includes('mac')
  ? 'darwin'
  : platform.includes('win')
    ? 'windows'
    : 'linux'

watchSystemColorScheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </StrictMode>
)
