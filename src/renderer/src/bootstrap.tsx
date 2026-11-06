import './assets/main.css'

import { MotionConfig } from 'motion/react'
import { startTransition, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'
import { RendererErrorBoundary } from './components/RendererErrorBoundary'
import { watchSystemColorScheme } from './systemColorScheme'

const onError = (event: ErrorEvent): void => {
  console.error('Uncaught renderer error:', event.error?.stack ?? event.message)
}

const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
  console.error(
    'Unhandled promise rejection:',
    event.reason instanceof Error ? event.reason.stack : event.reason
  )
}
window.addEventListener('error', onError)
window.addEventListener('unhandledrejection', onUnhandledRejection)

const platform = navigator.platform.toLocaleLowerCase()
document.documentElement.dataset.platform = platform.includes('mac')
  ? 'darwin'
  : platform.includes('win')
    ? 'windows'
    : 'linux'

const stopWatchingColorScheme = watchSystemColorScheme()

// Keep the mounted tree when an update propagates to this entry module. React
// Refresh still decides whether each component's hook signature can keep state.
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) {
  import.meta.hot.data.root = root
  import.meta.hot.accept()
  import.meta.hot.dispose(() => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    stopWatchingColorScheme()
  })
}

// Initial reconciliation must be able to yield before the workspace is mounted.
startTransition(() =>
  root.render(
    <StrictMode>
      <RendererErrorBoundary>
        <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: 'easeOut' }}>
          <App />
        </MotionConfig>
      </RendererErrorBoundary>
    </StrictMode>
  )
)
