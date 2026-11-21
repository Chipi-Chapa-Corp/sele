import { mobileLinkUrl } from './mobileBrowserUrl'
import { createRendererBridge } from '../../shared/rendererBridge'
import { localAccessChannels } from '../../shared/localAccess'
import type { AppLocalMedia, AppSelectedAttachment } from '../../shared/app'
import { createLanPreferences } from './lanPreferences'
import { publishLanReconnected } from './lanConnectionEvents'
import { appIpcChannels } from '../../shared/app'
import { providerIpcChannels } from '../../shared/provider'
import { preferencesChannel, type PreferenceResult } from '../../shared/preferences'
import { isLocalPreference } from '../../shared/preferenceSync'
import { createLocalPreferences } from './localPreferences'
import { LanTransport } from './lanTransport'
import { isAndroidClient } from './runtimeCapabilities'
import { Capacitor } from '@capacitor/core'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConnectionStatus } from './components/ConnectionStatus'
import { localNetwork } from './nativeLocalNetwork'
import { createLanSocket } from './secureLanSocket'
import { watchNearbyComputers } from './mobileDiscovery'
import {
  createAndroidPreferences,
  initializeAndroidStorage,
  readAndroidStorage,
  writeAndroidStorage
} from './androidStorage'
import {
  mobileWebSocketUrl,
  mobileConnectionStorageKey,
  mobileDevicesStorageKey,
  forgetMobileConnection,
  mobileConnectionLink,
  type MobileConnection,
  parseMobileConnection,
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

let connectionStatusRoot: Root | null = null
let connectionChooserOpen = false
const showConnection = (message: string | null): void => {
  // The chooser owns progress and errors while pairing. An old workspace banner
  // must not obscure its identity check or show a stale certificate warning.
  if (connectionChooserOpen) message = null
  if (!connectionStatusRoot) {
    if (!message) return
    const container = document.createElement('div')
    document.body.append(container)
    connectionStatusRoot = createRoot(container)
  }
  connectionStatusRoot.render(
    createElement(ConnectionStatus, {
      message,
      onChooseDevice: isAndroidClient()
        ? () => void forgetMobileConnection().catch(console.error)
        : undefined
    })
  )
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
    for (const key of [mobileConnectionStorageKey, mobileDevicesStorageKey]) {
      const stored = readAndroidStorage(key)
      if (stored) localStorage.setItem(key, stored)
      else localStorage.removeItem(key)
    }
  }
  let mobileConnection = android ? readMobileConnection() : null
  const parameters = new URLSearchParams(location.hash.slice(1))
  let token =
    mobileConnection?.token ??
    parameters.get('token') ??
    sessionStorage.getItem('sele-local-access-token')
  if (parameters.has('token')) history.replaceState(null, '', location.pathname + location.search)
  let transport!: LanTransport
  let initialPreferences!: PreferenceResult
  let stopDiscovery = (): void => {}
  let resynchronize = (): void => {}
  const connect = async (
    candidate: MobileConnection | null,
    signal?: AbortSignal
  ): Promise<void> => {
    const deviceId = nativeStorage ? (await localNetwork.deviceInfo()).id : undefined
    if (signal?.aborted) return
    transport?.close()
    stopDiscovery()
    if (candidate) token = candidate.token
    const current = new LanTransport(
      candidate
        ? mobileWebSocketUrl(candidate)
        : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/sele/ws`,
      token!,
      showConnection,
      () => resynchronize(),
      undefined,
      deviceId,
      (url) => createLanSocket(url, candidate?.fingerprint)
    )
    transport = current
    const abortConnection = (): void => current.close()
    signal?.addEventListener('abort', abortConnection, { once: true })
    showConnection(`Connecting to ${candidate?.name ?? 'Sele'}…`)
    // Use addresses advertised for this computer, keeping the saved address as
    // a fallback when discovery is absent or advertises an unreachable route.
    const stopWatching = candidate?.hostId
      ? watchNearbyComputers((computers) => {
          const found = computers.find((computer) => computer.id === candidate.hostId)
          const endpoints: string[] = []
          for (const origin of found?.origins ?? (found ? [found.origin] : [])) {
            try {
              const endpoint = parseMobileConnection(mobileConnectionLink({ ...candidate, origin }))
              endpoints.push(mobileWebSocketUrl(endpoint))
            } catch {
              // Discovery may return an address the WebView URL parser cannot use.
            }
          }
          current.updateEndpoints([...endpoints, mobileWebSocketUrl(candidate)])
        })
      : () => {}
    try {
      if (candidate?.hostId) await current.waitUntilReady(10_000)
      else await current.connect()
      const loadPreferences = { action: 'load' }
      initialPreferences = android
        ? await current.invokeWithTimeout<PreferenceResult>(
            preferencesChannel,
            5000,
            loadPreferences
          )
        : await current.invoke<PreferenceResult>(preferencesChannel, loadPreferences)
      if (!initialPreferences.ok) throw new Error(initialPreferences.error)
      // Persist the endpoint that actually authenticated, including discovery changes.
      mobileConnection = candidate && {
        ...candidate,
        origin: new URL(current.endpoint).origin.replace(/^ws/, 'http')
      }
      stopDiscovery = stopWatching
    } catch (error) {
      current.close()
      stopWatching()
      throw error
    } finally {
      signal?.removeEventListener('abort', abortConnection)
    }
  }
  if (android) {
    const error =
      !mobileConnection && localStorage.getItem(mobileConnectionStorageKey)
        ? 'Pair your computer again to verify its encrypted connection. Update desktop Sele first.'
        : undefined
    connectionChooserOpen = true
    try {
      await requestMobileConnection(error, mobileConnection, connect)
    } finally {
      connectionChooserOpen = false
    }
  } else {
    for (;;) {
      token ||= await requestToken()
      try {
        await connect(null)
        break
      } catch (error) {
        transport.close()
        showConnection(null)
        token = await requestToken(error instanceof Error ? error.message : String(error))
      }
    }
  }
  const saveConnectedDevice = async (): Promise<void> => {
    if (!mobileConnection) return
    mobileConnection = {
      ...mobileConnection,
      origin: transport.endpoint.replace(/^ws/, 'http').replace(/\/sele\/ws$/, '')
    }
    saveMobileConnection(mobileConnection)
    if (nativeStorage) {
      await Promise.all(
        [mobileConnectionStorageKey, mobileDevicesStorageKey].map((key) =>
          writeAndroidStorage(key, localStorage.getItem(key))
        )
      )
    }
  }
  if (mobileConnection) await saveConnectedDevice()
  else sessionStorage.setItem('sele-local-access-token', token!)
  const bridge = createRendererBridge(transport, () => {
    throw new Error('Upload this file from the phone first.')
  })
  const upload = async (files: File[]): Promise<AppSelectedAttachment[]> => {
    if (!files.length) return []
    if (files.length > 10 || files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) {
      throw new Error('Choose up to ten attachments smaller than 32 MB in total.')
    }
    // Avoid holding all original images, their base64 copies and the reply in
    // WebView memory at once. The selection limit still applies to the batch.
    const attachments: AppSelectedAttachment[] = []
    for (const file of files) {
      const data = await file.arrayBuffer()
      await transport.waitUntilReady()
      attachments.push(
        ...(await transport.invoke<AppSelectedAttachment[]>(localAccessChannels.uploadAttachments, [
          {
            name: file.name,
            type: file.type,
            data
          }
        ]))
      )
    }
    return attachments
  }
  bridge.appApi.getDroppedMessageAttachments = async (files) => {
    return upload(files)
  }
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
      try {
        input.click()
      } catch (error) {
        input.remove()
        reject(error)
      }
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
    url = mobileLinkUrl(url, transport.endpoint.replace(/^ws/, 'http'))
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
    chrome: { connected: false, pairingUrl: null, error: null },
    opera: { connected: false, pairingUrl: null, error: null }
  })
  const namespace = mobileConnection
    ? `sele-android-host:${encodeURIComponent(mobileConnection.hostId ?? mobileConnection.origin)}:`
    : ''
  const local = nativeStorage
    ? createAndroidPreferences(namespace)
    : createLocalPreferences(localStorage, namespace)
  const shared = createLanPreferences({
    transport,
    initial: initialPreferences,
    key: `${namespace}shared-outbox-v1`,
    storage: nativeStorage
      ? { getItem: readAndroidStorage, setItem: writeAndroidStorage }
      : localStorage
  })
  let viewedChat: Parameters<typeof bridge.providerApi.setViewedChat> = [null, null]
  bridge.providerApi.setViewedChat = (...args) => {
    viewedChat = args
    transport.send(providerIpcChannels.viewedChatChanged, ...args)
  }
  resynchronize = () => {
    // Restore only subscription state. Never resend a prompt, terminal input,
    // approval, upload, or other mutation whose outcome might be uncertain.
    if (transport.hasListeners(providerIpcChannels.chatUpdated))
      transport.send(providerIpcChannels.chatUpdatesReady)
    transport.send(providerIpcChannels.viewedChatChanged, ...viewedChat)
    void Promise.allSettled([
      saveConnectedDevice(),
      shared.reconnect(),
      bridge.appApi
        .getChatSleep()
        .then((state) => transport.emit(appIpcChannels.chatSleepUpdated, state))
    ]).then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected')
          console.warn('Unable to refresh reconnected state.', result.reason)
      })
      if (!transport.isReady) return
      transport.emit(appIpcChannels.workspaceUpdated)
      publishLanReconnected()
    })
  }
  Object.assign(window, bridge, {
    seleRemoteClient: true,
    seleHostOrigin: () => new URL(transport.endpoint.replace(/^ws/, 'http')).origin,
    preferencesApi: {
      initialize: async (): Promise<PreferenceResult> => {
        const result = await shared.initialize()
        if (!result.ok) return result
        const localResult = await local.initialize()
        if (!localResult.ok) return localResult
        void shared
          .syncPending()
          .catch((error) => console.warn('Unable to sync saved drafts.', error))
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
  const resume = (): void => {
    if (document.visibilityState !== 'hidden') transport.resume()
  }
  window.addEventListener('online', resume)
  window.addEventListener('pageshow', resume)
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) {
      stopDiscovery()
      transport.close()
    }
  })
}
