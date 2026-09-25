import './assets/main.css'

import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RendererErrorBoundary } from './components/RendererErrorBoundary'
import { watchSystemColorScheme } from './systemColorScheme'

window.addEventListener('error', (event) => {
  console.error('Uncaught renderer error:', event.error?.stack ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error(
    'Unhandled promise rejection:',
    event.reason instanceof Error ? event.reason.stack : event.reason
  )
})

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
      <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: 'easeOut' }}>
        <App />
      </MotionConfig>
    </RendererErrorBoundary>
  </StrictMode>
)
