import { createRendererBridge } from '../../shared/rendererBridge'
import { localAccessChannels } from '../../shared/localAccess'
import type { AppLocalMedia, AppSelectedAttachment } from '../../shared/app'
import { createPreferenceClient } from '../../preload/preferenceClient'
import {
  preferencesChannel,
  type PreferenceChanges,
  type PreferenceResult
} from '../../shared/preferences'
import { isLocalPreference, preferencesChangedChannel } from '../../shared/preferenceSync'
import { createLocalPreferences } from './localPreferences'
import { LanTransport } from './lanTransport'
import { isAndroidClient } from './runtimeCapabilities'
import { Capacitor } from '@capacitor/core'
import { localNetwork } from './nativeLocalNetwork'
import { findSavedComputer } from './mobileDiscovery'
import {
  createAndroidPreferences,
  initializeAndroidStorage,
  readAndroidStorage,
  writeAndroidStorage
} from './androidStorage'
import {
  mobileWebSocketUrl,
  readMobileConnection,
  requestMobileConnection,
  saveMobileConnection
} from './mobileConnection'

// randomUUID is restricted to secure contexts; getRandomValues also works on
// plain HTTP LAN origins. Existing UI code can keep using crypto.randomUUID().
export const installLanUuid = (): void => {
  if (typeof crypto.randomUUID === 'function') return
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 15) | 64
    bytes[8] = (bytes[8] & 63) | 128
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}

const showConnection = (message: string | null): void => {
  document.getElementById('sele-connection-status')?.remove()
  if (!message) return
  const status = document.createElement('div')
  status.id = 'sele-connection-status'
  status.className = 'sele-connection-status'
  status.setAttribute('role', 'status')
  status.textContent = message
  document.body.append(status)
}

const requestToken = (error?: string): Promise<string> =>
  new Promise((resolve) => {
    const form = document.createElement('form')
    form.style.cssText = 'padding:32px;font:16px system-ui;display:grid;gap:16px;max-width:600px'
    const title = document.createElement('h1')
    title.textContent = 'Connect to Sele'
    const description = document.createElement('p')
    description.textContent =
      error ??
      'Open a connection link from Settings → Local network on your computer, or paste the link below.'
    const input = document.createElement('input')
    input.type = 'password'
    input.autocomplete = 'off'
    input.required = true
    input.placeholder = 'Connection link or access key'
    input.setAttribute('aria-label', 'Connection link or access key')
    const button = document.createElement('button')
    button.type = 'submit'
    button.textContent = 'Connect'
    form.append(title, description, input, button)
    document.getElementById('root')!.replaceChildren(form)
    form.onsubmit = (event) => {
      event.preventDefault()
      let value = input.value.trim()
      if (/^https?:\/\//.test(value)) {
        try {
          value = new URLSearchParams(new URL(value).hash.slice(1)).get('token') ?? value
        } catch {
          console.warn('Invalid local-access connection link.')
        }
      }
      form.remove()
      resolve(value)
    }
  })

const copyText = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.inputMode = 'none'
  input.setAttribute('aria-hidden', 'true')
  input.style.cssText = 'position:fixed;opacity:0'
  document.body.append(input)
  input.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Use your browser’s Copy command.')
  } finally {
    input.remove()
  }
}

const downloadMedia = async (media: AppLocalMedia, path: string): Promise<string | null> => {
  const name = path.split(/[\\/]/).pop() || 'download'
  if (Capacitor.isNativePlatform()) {
    const data = new Uint8Array(media.data)
    let binary = ''
    for (let offset = 0; offset < data.length; offset += 8192)
      binary += String.fromCharCode(...data.subarray(offset, offset + 8192))
    return (await localNetwork.saveFile({ name, type: media.mimeType, data: btoa(binary) })).path
  }
  const url = URL.createObjectURL(new Blob([media.data], { type: media.mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return link.download
}

export const initializeLanBridge = async (): Promise<void> => {
  installLanUuid()
  const android = isAndroidClient()
  const nativeStorage = android && Capacitor.isNativePlatform()
  if (nativeStorage) {
    await initializeAndroidStorage()
    const stored = readAndroidStorage('sele-android-connection-v1')
    if (stored) localStorage.setItem('sele-android-connection-v1', stored)
    else localStorage.removeItem('sele-android-connection-v1')
  }
  let mobileConnection = android ? readMobileConnection() : null
  if (mobileConnection) mobileConnection = await findSavedComputer(mobileConnection)
  if (android && !mobileConnection) mobileConnection = await requestMobileConnection()
  const parameters = new URLSearchParams(location.hash.slice(1))
  let token =
    mobileConnection?.token ??
    parameters.get('token') ??
    sessionStorage.getItem('sele-local-access-token')
  if (parameters.has('token')) history.replaceState(null, '', location.pathname + location.search)
  let transport: LanTransport
  for (;;) {
    token ||= await requestToken()
    transport = new LanTransport(
      mobileConnection
        ? mobileWebSocketUrl(mobileConnection)
        : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/sele/ws`,
      token,
      showConnection,
      () => location.reload(),
      android ? () => location.reload() : undefined
    )
    try {
      await transport.connect()
      const result = await transport.invoke<PreferenceResult>(preferencesChannel, {
        action: 'load'
      })
      if (!result.ok) throw new Error(result.error)
      break
    } catch (error) {
      console.warn('Unable to connect to Sele.', error)
      transport.close()
      showConnection(null)
      const message = error instanceof Error ? error.message : String(error)
      if (android) {
        mobileConnection = await requestMobileConnection(message, mobileConnection)
        token = mobileConnection.token
      } else token = await requestToken(message)
    }
  }
  if (mobileConnection) {
    saveMobileConnection(mobileConnection)
    if (nativeStorage)
      await writeAndroidStorage('sele-android-connection-v1', JSON.stringify(mobileConnection))
  } else sessionStorage.setItem('sele-local-access-token', token)
  const bridge = createRendererBridge(transport, () => {
    throw new Error('Upload this file from the phone first.')
  })
  const upload = async (files: File[]): Promise<AppSelectedAttachment[]> => {
    if (!files.length) return []
    if (files.length > 10 || files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) {
      throw new Error('Choose up to ten attachments smaller than 32 MB in total.')
    }
    return transport.invoke(
      localAccessChannels.uploadAttachments,
      await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
          data: await file.arrayBuffer()
        }))
      )
    )
  }
  bridge.appApi.getDroppedMessageAttachments = upload
  bridge.appApi.selectMessageAttachments = () =>
    new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.style.display = 'none'
      document.body.append(input)
      input.onchange = () => {
        const files = Array.from(input.files ?? [])
        input.remove()
        void upload(files).then(resolve, reject)
      }
      input.oncancel = () => {
        input.remove()
        resolve([])
      }
      input.click()
    })
  const chooseHostPath = async (initialPath: string, file = false): Promise<string | null> => {
    const { requestHostPath } = await import('./components/HostPathDialog')
    return requestHostPath({
      initialPath,
      file,
      browse: (path) => transport.invoke(localAccessChannels.browseHostDirectory, path)
    })
  }
  bridge.appApi.selectFolder = async (options) =>
    chooseHostPath(options?.defaultPath ?? (await bridge.appApi.getDefaultCwd()))
  bridge.appApi.selectSshIdentityFile = async () => chooseHostPath('~/.ssh', true)
  bridge.appApi.readClipboardText = async () =>
    navigator.clipboard?.readText ? navigator.clipboard.readText() : ''
  bridge.appApi.writeClipboardText = copyText
  bridge.appApi.getClipboardImage = async () => null
  bridge.appApi.getColorScheme = async () =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  bridge.appApi.onColorSchemeUpdated = (listener) => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => listener(query.matches ? 'dark' : 'light')
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }
  bridge.appApi.getInstalledFontFamilies = async () => []
  bridge.appApi.getWindowState = async () => ({ isMaximized: false })
  bridge.appApi.setWindowZoomLevel = async () => {}
  bridge.appApi.minimizeWindow = async () => {}
  bridge.appApi.closeWindow = async () => {}
  bridge.appApi.toggleWindowMaximized = async () => ({ isMaximized: false })
  bridge.appApi.getAppUpdate = async () => ({
    version: null,
    status: 'idle',
    progress: null,
    error: null
  })
  bridge.appApi.exportDiagnosticLog = async () =>
    downloadMedia(
      {
        data: new TextEncoder().encode(
          await transport.invoke<string>(localAccessChannels.readDiagnosticLog)
        ).buffer,
        mimeType: 'text/plain',
        updatedAt: Date.now()
      },
      `sele-diagnostics-${new Date().toISOString().slice(0, 10)}.log`
    )
  bridge.appApi.dismissAppUpdate = async () => {}
  bridge.appApi.handleExternalLink = async ({ url, action = 'open' }) => {
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(url).protocol))
      throw new Error('Unsupported link.')
    if (action === 'copy') await copyText(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
    return { action, always: false }
  }
  bridge.appApi.saveLocalImage = async (options) =>
    downloadMedia(await bridge.appApi.getLocalImage(options), options.path)
  bridge.appApi.saveLocalVideo = async (options) =>
    downloadMedia(await bridge.appApi.getLocalVideo(options), options.path)
  bridge.browserApi.setActive = () => {}
  bridge.browserApi.automationReady = () => {}
  bridge.browserApi.setAutomationVisible = () => {}
  bridge.browserApi.resolvePageZoomScale = async () => 1
  bridge.desktopApi.getState = async () => ({
    computer: { connected: false, connecting: false, backend: null, error: null },
    chrome: { connected: false, pairingUrl: null }
  })
  const namespace = mobileConnection
    ? `sele-android-host:${encodeURIComponent(mobileConnection.hostId ?? mobileConnection.origin)}:`
    : ''
  const local = nativeStorage
    ? createAndroidPreferences(namespace)
    : createLocalPreferences(localStorage, namespace)
  const sourceId = crypto.randomUUID()
  let revision = 0
  const shared = createPreferenceClient({
    initialize: () => transport.invoke(preferencesChannel, { action: 'load' }),
    write: (values) =>
      transport.invoke(preferencesChannel, {
        action: 'write',
        sourceId,
        revision: ++revision,
        values
      }),
    // WebView cannot synchronously block on a socket; edits are sent immediately
    // and explicit flush waits for host durability before navigation/reload.
    commit: () => ({ ok: true, value: null }),
    subscribe: (listener) => {
      const handler = (_event: unknown, changes: PreferenceChanges): void => listener(changes)
      transport.on(preferencesChangedChannel, handler)
      return () => {
        transport.removeListener(preferencesChangedChannel, handler)
      }
    }
  })
  Object.assign(window, bridge, {
    seleRemoteClient: true,
    preferencesApi: {
      initialize: async (): Promise<PreferenceResult> => {
        const result = await shared.initialize()
        if (!result.ok) return result
        const localResult = await local.initialize()
        if (!localResult.ok) return localResult
        return {
          ok: true,
          value: {
            ...(result.value as object),
            ...Object.fromEntries(
              Object.entries(localResult.value ?? {}).filter(([key]) => isLocalPreference(key))
            )
          }
        }
      },
      getItem: (key: string) => (isLocalPreference(key) ? local : shared).getItem(key),
      setItem: (key: string, value: string) =>
        (isLocalPreference(key) ? local : shared).setItem(key, value),
      removeItem: (key: string) => (isLocalPreference(key) ? local : shared).removeItem(key),
      flush: async () => {
        const result = await local.flush()
        return result.ok ? shared.flush() : result
      },
      commitPending: () => {
        const result = local.commitPending()
        return result.ok ? shared.commitPending() : result
      },
      onChanged: shared.onChanged,
      onFailure: (listener: (error: string) => void) => {
        const stopShared = shared.onFailure(listener)
        const stopLocal = local.onFailure(listener)
        return () => {
          stopShared()
          stopLocal()
        }
      }
    }
  })
  window.addEventListener('pagehide', () => transport.close(), { once: true })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload()
  })
}
