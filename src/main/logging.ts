import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { createDiagnosticLog, type LogLevel } from './diagnosticLog'

app.setAppLogsPath()
export const diagnosticLog = createDiagnosticLog(join(app.getPath('logs'), 'sele.log'))
const originalError = console.error.bind(console)

export const logDiagnostic = (level: LogLevel, source: string, ...args: unknown[]): void => {
  try {
    diagnosticLog.write(level, source, ...args)
  } catch (error) {
    // Logging must never break the operation being diagnosed or recurse into itself.
    originalError('Unable to write diagnostic log:', error)
  }
}

for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]): void => {
    logDiagnostic(level, 'main', ...args)
    original(...args)
  }
}

process.on('warning', (warning) => logDiagnostic('warn', 'process', warning))
// Monitor preserves Node/Electron's normal fatal-exception behavior.
process.on('uncaughtExceptionMonitor', (error, origin) => logDiagnostic('error', origin, error))
process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason))

app.on('web-contents-created', (_event, contents) => {
  // Webviews contain third-party browsing content, not Sele diagnostics.
  if (contents.getType() !== 'window') return
  contents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return
    logDiagnostic(
      details.level === 'warning' ? 'warn' : 'error',
      'renderer',
      `${details.sourceId}:${details.lineNumber}`,
      details.message
    )
  })
  contents.on('preload-error', (_event, path, error) =>
    logDiagnostic('error', 'preload', path, error)
  )
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') logDiagnostic('error', 'renderer-process', details)
  })
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) logDiagnostic('error', 'renderer-load', code, description)
  })
})
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') logDiagnostic('error', 'child-process', details)
})

// Record failures even when the interface catches an IPC rejection to display it.
export const handleLoggedIpc: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args)
    } catch (error) {
      logDiagnostic('error', `ipc:${channel}`, error)
      throw error
    }
  })
}

logDiagnostic('info', 'startup', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node
})
