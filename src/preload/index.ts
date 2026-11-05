import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createRendererBridge } from '../shared/rendererBridge'
import { preferencesChannel, type PreferencesApi } from '../shared/preferences'
import { preferencesChangedChannel } from '../shared/preferenceSync'
import { createPreferenceClient } from './preferenceClient'

const bridge = createRendererBridge(
  {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener as (...args: unknown[]) => void),
    removeListener: (channel, listener) =>
      ipcRenderer.removeListener(channel, listener as (...args: unknown[]) => void)
  },
  (file) => webUtils.getPathForFile(file)
)
for (const [name, api] of Object.entries(bridge)) contextBridge.exposeInMainWorld(name, api)

const preferenceSourceId = crypto.randomUUID()
let preferenceRevision = 0
const preferenceWriteRequest = (values: import('../shared/preferences').PreferenceChanges) => ({
  action: 'write' as const,
  sourceId: preferenceSourceId,
  revision: ++preferenceRevision,
  values
})
const preferencesApi: PreferencesApi = createPreferenceClient({
  initialize: (values) =>
    ipcRenderer.invoke(
      preferencesChannel,
      values === undefined ? { action: 'load' } : { action: 'migrate', values }
    ),
  write: (values) => ipcRenderer.invoke(preferencesChannel, preferenceWriteRequest(values)),
  commit: (values) => ipcRenderer.sendSync(preferencesChannel, preferenceWriteRequest(values)),
  subscribe: (listener) => {
    const handler = (
      _event: unknown,
      changes: import('../shared/preferences').PreferenceChanges
    ): void => listener(changes)
    ipcRenderer.on(preferencesChangedChannel, handler)
    return () => {
      ipcRenderer.removeListener(preferencesChangedChannel, handler)
    }
  }
})
contextBridge.exposeInMainWorld('preferencesApi', preferencesApi)
