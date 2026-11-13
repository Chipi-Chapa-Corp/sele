import { syncBrowserTabs } from './browserSync'
import { webContents } from 'electron'
import type { RendererClient } from './clientIpc'
import {
  getBrowserAutomationService,
  type BrowserAutomationClient
} from './browser/BrowserAutomation'
import type { RemoteBrowserRequest, RemoteBrowserState } from '../shared/remoteBrowser'
import type { ProviderId } from '../shared/provider'
import { providerIds } from '../shared/provider'
import { isBrowserPageUrl } from '../shared/browser'

type Entry = {
  workspace: string
  viewId?: string
  browser: BrowserAutomationClient
  pending: Promise<unknown>
}
const clients = new Map<number, Entry>()
const watchedClients = new Set<number>()

export const remoteBrowserRequest = (
  client: RendererClient,
  value: unknown
): Promise<RemoteBrowserState | null> => {
  if (client.isDestroyed()) throw new Error('Client disconnected.')
  if (!value || typeof value !== 'object') throw new Error('Invalid browser request.')
  const request = value as RemoteBrowserRequest
  if (
    (request.viewId !== undefined &&
      (typeof request.viewId !== 'string' || request.viewId.length > 80)) ||
    typeof request.workspaceKey !== 'string' ||
    request.workspaceKey.length > 8192 ||
    typeof request.cwd !== 'string' ||
    request.cwd.length > 4096
  )
    throw new Error('Invalid browser workspace.')
  if (request.method === 'sync')
    return Promise.resolve({ tabs: [], sync: syncBrowserTabs(request.workspaceKey, request.opens) })
  let entry = clients.get(client.id)
  const workspace = `${request.workspaceKey}\0${request.cwd}`
  if (
    ![
      'state',
      'tabs',
      'create',
      'activate',
      'close',
      'navigate',
      'back',
      'forward',
      'reload',
      'click',
      'scroll',
      'text',
      'key',
      'release'
    ].includes(request.method)
  )
    throw new Error('Unsupported browser action.')
  if (request.method === 'release') {
    if (entry?.workspace === workspace && entry.viewId === request.viewId) {
      entry.browser.close()
      clients.delete(client.id)
    }
    return Promise.resolve(null)
  }
  if (!entry || entry.workspace !== workspace || entry.viewId !== request.viewId) {
    entry?.browser.close()
    const service = getBrowserAutomationService()
    if (!service) throw new Error('Enable the browser in Sele on your computer.')
    const chat = request.workspaceKey.startsWith('chat:') ? request.workspaceKey.slice(5) : ''
    const separator = chat.indexOf(':')
    const provider = chat.slice(0, separator)
    entry = {
      workspace,
      viewId: request.viewId,
      pending: Promise.resolve(),
      browser: service.createClient({
        providerId: providerIds.includes(provider as ProviderId)
          ? (provider as ProviderId)
          : 'codex',
        sessionId: separator > 0 ? chat.slice(separator + 1) : `phone-${client.id}`,
        cwd: request.cwd,
        workspaceKey: request.workspaceKey,
        containerKey: request.workspaceKey.startsWith('project:')
          ? request.workspaceKey.slice(8).split('\0')[0]
          : 'host'
      })
    }
    clients.set(client.id, entry)
    if (!watchedClients.has(client.id)) {
      watchedClients.add(client.id)
      client.once('destroyed', () => {
        clients.get(client.id)?.browser.close()
        clients.delete(client.id)
        watchedClients.delete(client.id)
      })
    }
  }
  const owned = entry
  const perform = async (): Promise<RemoteBrowserState | null> => {
    if (client.isDestroyed()) throw new Error('Client disconnected.')
    if (request.method === 'create') {
      await owned.browser.createTab({ foreground: false })
      return null
    }
    const tabs = await owned.browser.listTabs()
    // A phone opens these URLs locally; listing never captures the desktop.
    if (request.method === 'tabs') return { tabs }
    const id = request.tabId ?? tabs.find((tab) => tab.active)?.id ?? tabs[0]?.id
    if (request.method === 'state') {
      if (id === undefined) return { tabs }
    } else if (!Number.isSafeInteger(id)) throw new Error('Choose a browser tab first.')
    if (id === undefined) return { tabs }
    if (!tabs.some((tab) => tab.id === id))
      throw new Error('This tab is outside the selected workspace.')
    const guest = webContents.fromId(id)
    if (!guest || guest.isDestroyed() || guest.getType() !== 'webview')
      throw new Error('Browser tab closed.')
    switch (request.method) {
      case 'state': {
        const image = await guest.capturePage()
        const size = image.getSize()
        if (!size.width || !size.height) return { tabs }
        const preview = size.width > 1024 ? image.resize({ width: 1024 }) : image
        return {
          tabs,
          frame: {
            dataUrl: `data:image/jpeg;base64,${preview.toJPEG(75).toString('base64')}`,
            width: size.width,
            height: size.height,
            canGoBack: guest.navigationHistory.canGoBack(),
            canGoForward: guest.navigationHistory.canGoForward()
          }
        }
      }
      case 'activate':
        await owned.browser.activateTab(id)
        break
      case 'close':
        await owned.browser.closeTab(id)
        break
      case 'navigate':
        if (
          typeof request.url !== 'string' ||
          request.url.length > 4096 ||
          !isBrowserPageUrl(request.url)
        )
          throw new Error('Enter an HTTP or HTTPS address.')
        await guest.loadURL(request.url)
        break
      case 'back':
        if (guest.navigationHistory.canGoBack()) guest.navigationHistory.goBack()
        break
      case 'forward':
        if (guest.navigationHistory.canGoForward()) guest.navigationHistory.goForward()
        break
      case 'reload':
        guest.reload()
        break
      case 'click': {
        if (
          !Number.isFinite(request.x) ||
          !Number.isFinite(request.y) ||
          request.x! < 0 ||
          request.y! < 0 ||
          request.x! > 32768 ||
          request.y! > 32768
        )
          throw new Error('Invalid browser coordinates.')
        const point = { x: Math.round(request.x!), y: Math.round(request.y!) }
        await owned.browser.executeCdp(id, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...point,
          button: 'left',
          clickCount: 1
        })
        await owned.browser.executeCdp(id, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...point,
          button: 'left',
          clickCount: 1
        })
        break
      }
      case 'scroll':
        if (!Number.isFinite(request.deltaY) || Math.abs(request.deltaY!) > 5000)
          throw new Error('Invalid scroll distance.')
        if (
          [request.x, request.y].some(
            (value) =>
              value !== undefined && (!Number.isFinite(value) || value < 0 || value > 32768)
          )
        )
          throw new Error('Invalid browser coordinates.')
        await owned.browser.executeCdp(id, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: Math.max(0, Math.round(request.x ?? 1)),
          y: Math.max(0, Math.round(request.y ?? 1)),
          deltaY: request.deltaY!,
          deltaX: 0
        })
        break
      case 'text':
        if (typeof request.text !== 'string' || request.text.length > 4096)
          throw new Error('Type a shorter value.')
        await owned.browser.executeCdp(id, 'Input.insertText', { text: request.text })
        break
      case 'key': {
        if (!['Backspace', 'Enter', 'Tab', 'Escape'].includes(request.key ?? ''))
          throw new Error('Unsupported browser key.')
        const keyCode = { Backspace: 8, Enter: 13, Tab: 9, Escape: 27 }[request.key!]
        await owned.browser.executeCdp(id, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: request.key,
          code: request.key,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
          ...(request.key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {})
        })
        await owned.browser.executeCdp(id, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: request.key,
          code: request.key,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode
        })
        break
      }
    }
    return null
  }
  const operation = owned.pending
    .catch((error) => console.warn('Previous phone browser action failed.', error))
    .then(perform)
  owned.pending = operation
  return operation
}
