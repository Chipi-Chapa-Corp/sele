import { app, protocol } from 'electron'
import { startSingleInstance } from './singleInstance'

protocol.registerSchemesAsPrivileged([
  { scheme: 'sele-visualize', privileges: { standard: true, secure: true } },
  { scheme: 'sele-mcp-app', privileges: { standard: true, secure: true } }
])

// Importing the application initializes provider adapters and shutdown hooks.
// Only the process holding Electron's profile lock may load that runtime.
void startSingleInstance(app, async () => {
  const { startApplication } = await import('./application')
  return startApplication()
})
