import { app, BrowserWindow, ipcMain, session, webContents, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { BrowserDownloads, type BrowserDownload } from './BrowserDownloads'
export type { BrowserDownload } from './BrowserDownloads'
import {
  browserIpcChannels,
  isBrowserPageUrl,
  type BrowserAutomationRequest,
  type BrowserAutomationResponse,
  type BrowserAutomationScope,
  type BrowserAutomationTab
} from '../../shared/browser'

export type BrowserCdpParams = Record<string, unknown>
export type BrowserCdpEvent =
  | { type: 'message'; tabId: number; method: string; params: BrowserCdpParams; sessionId?: string }
  | { type: 'detach'; tabId: number }
  | { type: 'download'; download: BrowserDownload }

/** A revocable, workspace-scoped browser capability; no provider or wire protocol here. */
export interface BrowserAutomationClient {
  readonly scope: BrowserAutomationScope
  listTabs(): Promise<BrowserAutomationTab[]>
  createTab(options?: { foreground?: boolean }): Promise<BrowserAutomationTab>
  activateTab(id: number): Promise<void>
  closeTab(id: number): Promise<void>
  visibility(visible?: boolean): Promise<{ visible: boolean }>
  moveMouse(id: number, x: number, y: number): Promise<void>
  attach(id: number): Promise<void>
  detach(id: number): void
  detachAll(): void
  executeCdp(
    id: number,
    method: string,
    params?: BrowserCdpParams,
    childSessionId?: string,
    childTargetId?: string
  ): Promise<BrowserCdpParams>
  allowDownload(id: number, url: string): Promise<void>
  waitForDownload(id: number, timeoutMs?: number): Promise<BrowserDownload>
  listDownloads(id: number): Promise<BrowserDownload[]>
  close(): void
}

export interface BrowserAutomationService {
  createClient(
    scope: BrowserAutomationScope,
    onEvent?: (event: BrowserCdpEvent) => void
  ): BrowserAutomationClient
  close(): void
}

type PendingUi = {
  renderer: WebContents
  owner: object
  request: BrowserAutomationRequest
  sent: boolean
  accepted: boolean
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let service: BrowserAutomationService | undefined
export const getBrowserAutomationService = (): BrowserAutomationService | undefined => service

export function startBrowserAutomationService(): BrowserAutomationService {
  if (service) throw new Error('Browser automation is already running')
  const pending = new Map<string, PendingUi>()
  const ready = new Set<number>()
  const clients = new Set<BrowserAutomationClient>()
  const attached = new Map<number, { owner: object; cleanup: () => void }>()
  const focusQueues = new Map<number, Promise<BrowserCdpParams>>()
  let stopped = false
  const finishUi = (id: string, error?: Error, result?: unknown): void => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (error) entry.reject(error)
    else entry.resolve(result)
  }
  const sendUi = (entry: PendingUi): void => {
    if (
      entry.sent ||
      !entry.accepted ||
      !ready.has(entry.renderer.id) ||
      entry.renderer.isDestroyed()
    )
      return
    entry.sent = true
    entry.renderer.send(browserIpcChannels.automationRequest, entry.request)
  }
  const onReady = (event: Electron.IpcMainEvent, value: unknown): void => {
    if (!BrowserWindow.fromWebContents(event.sender)) return
    if (value === true) {
      ready.add(event.sender.id)
      for (const entry of pending.values()) if (entry.renderer === event.sender) sendUi(entry)
    } else {
      ready.delete(event.sender.id)
      // React StrictMode briefly unregisters the newly mounted panel. Keep requests
      // queued until it is ready again; the existing deadline handles a real closure.
      for (const entry of pending.values()) {
        if (entry.renderer === event.sender) entry.sent = false
      }
    }
  }
  const onAccept = (event: Electron.IpcMainEvent, id: unknown): void => {
    if (typeof id !== 'string') return
    const entry = pending.get(id)
    if (!entry || entry.renderer !== event.sender) return
    entry.accepted = true
    sendUi(entry)
  }
  const onResponse = (event: Electron.IpcMainEvent, response: BrowserAutomationResponse): void => {
    if (!response || typeof response.id !== 'string') return
    const entry = pending.get(response.id)
    if (entry?.renderer !== event.sender) return
    if (response.restoreFocus && BrowserWindow.fromWebContents(event.sender)?.isFocused()) {
      event.sender.focus()
    }
    finishUi(response.id, response.error ? new Error(response.error) : undefined, response.result)
  }
  const onVisibility = (event: Electron.IpcMainEvent, visible: unknown): void => {
    if (typeof visible !== 'boolean' || !BrowserWindow.fromWebContents(event.sender)) return
    event.sender.send(browserIpcChannels.automationVisibility, visible)
  }

  const ui = (
    scope: BrowserAutomationScope,
    command: Omit<BrowserAutomationRequest, 'id' | 'scope'>,
    owner: object,
    targetRenderer?: WebContents
  ): Promise<unknown> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const renderer = targetRenderer ?? window?.webContents
    if (!renderer || renderer.isDestroyed())
      return Promise.reject(new Error('Sele has no open window'))
    const focusRequest = command.method === 'preserve-focus' || command.method === 'release-focus'
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const entry: PendingUi = {
        renderer,
        owner,
        request: { ...command, scope, id },
        sent: false,
        accepted: focusRequest,
        resolve,
        reject,
        timer: setTimeout(() => finishUi(id, new Error('Sele browser did not respond')), 15000)
      }
      pending.set(id, entry)
      if (!focusRequest) renderer.send(browserIpcChannels.automationOpen, id)
      if (ready.has(renderer.id)) sendUi(entry)
    })
  }

  const tabs = async (
    scope: BrowserAutomationScope,
    owner: object
  ): Promise<BrowserAutomationTab[]> =>
    (await ui(scope, { method: 'list' }, owner)) as BrowserAutomationTab[]

  const guestFor = async (
    scope: BrowserAutomationScope,
    id: number,
    owner: object
  ): Promise<WebContents> => {
    if (!(await tabs(scope, owner)).some((tab) => tab.id === id))
      throw new Error('Tab is outside this browser workspace')
    const guest = webContents.fromId(id)
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.getType() !== 'webview' ||
      guest.session !== appSession()
    )
      throw new Error('Tab is not a Sele browser page')
    return guest
  }

  const createClient = (
    scope: BrowserAutomationScope,
    onEvent: (event: BrowserCdpEvent) => void = () => {}
  ): BrowserAutomationClient => {
    if (stopped) throw new Error('Browser automation stopped')
    const owner = {}
    let closed = false
    const childSessions = new Map<number, Map<string, BrowserCdpParams>>()
    let downloads: BrowserDownloads | undefined
    const downloadManager = (): BrowserDownloads =>
      (downloads ??= new BrowserDownloads(
        appSession(),
        (guest) => attached.get(guest.id)?.owner === owner,
        (download) => onEvent({ type: 'download', download })
      ))
    const assertOpen = (): void => {
      if (closed || stopped) throw new Error('Browser session closed')
    }
    const request = async (
      command: Omit<BrowserAutomationRequest, 'id' | 'scope'>
    ): Promise<unknown> => {
      assertOpen()
      const result = await ui(scope, command, owner)
      assertOpen()
      return result
    }
    const guestForId = async (id: number): Promise<WebContents> => {
      assertOpen()
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid browser tab ID')
      const guest = await guestFor(scope, id, owner)
      assertOpen()
      return guest
    }
    const detach = (id: number): void => {
      const state = attached.get(id)
      if (state?.owner !== owner) return
      attached.delete(id)
      state.cleanup()
      childSessions.delete(id)
      downloads?.revoke(id)
      const guest = webContents.fromId(id)
      if (guest && !guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
      onEvent({ type: 'detach', tabId: id })
    }
    const attach = async (id: number): Promise<WebContents> => {
      const guest = await guestForId(id)
      const existing = attached.get(id)
      if (existing && existing.owner !== owner)
        throw new Error('Tab is controlled by another browser session')
      if (existing) return guest
      if (guest.debugger.isAttached()) throw new Error('Tab debugger is already in use')
      guest.debugger.attach('1.3')
      const onMessage = (
        _: Electron.Event,
        method: string,
        params: BrowserCdpParams,
        sessionId?: string
      ): void => {
        let children = childSessions.get(id)
        if (!children) childSessions.set(id, (children = new Map()))
        if (method === 'Target.attachedToTarget') {
          const info = params.targetInfo as BrowserCdpParams | undefined
          if (info?.type !== 'iframe' || typeof params.sessionId !== 'string') {
            if (typeof params.sessionId === 'string')
              void guest.debugger
                .sendCommand('Target.detachFromTarget', { sessionId: params.sessionId }, sessionId)
                .catch(() => {})
            return
          }
          children.set(params.sessionId, info)
        } else if (method === 'Target.targetInfoChanged') {
          const info = params.targetInfo as BrowserCdpParams | undefined
          for (const [session, target] of children)
            if (target.targetId === info?.targetId) children.set(session, info!)
        } else if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') {
          children.delete(params.sessionId)
        }
        onEvent({ type: 'message', tabId: id, method, params, ...(sessionId ? { sessionId } : {}) })
      }
      const cleanup = (): void => {
        guest.debugger.removeListener('message', onMessage)
        guest.debugger.removeListener('detach', onDetach)
      }
      const onDetach = (): void => {
        attached.delete(id)
        cleanup()
        childSessions.delete(id)
        downloads?.revoke(id)
        onEvent({ type: 'detach', tabId: id })
      }
      guest.debugger.on('message', onMessage)
      guest.debugger.once('detach', onDetach)
      attached.set(id, { owner, cleanup })
      return guest
    }
    const client: BrowserAutomationClient = {
      scope,
      listTabs: async () => (await request({ method: 'list' })) as BrowserAutomationTab[],
      createTab: async (options) =>
        (await request({ method: 'create', ...options })) as BrowserAutomationTab,
      activateTab: async (tabId) => {
        await request({ method: 'activate', tabId })
      },
      closeTab: async (tabId) => {
        await guestForId(tabId)
        const existing = attached.get(tabId)
        if (existing && existing.owner !== owner)
          throw new Error('Tab is controlled by another browser session')
        detach(tabId)
        await request({ method: 'close', tabId })
      },
      visibility: async (visible) =>
        (await request({
          method: 'visibility',
          ...(visible === undefined ? {} : { visible })
        })) as { visible: boolean },
      moveMouse: async (id, x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid mouse coordinates')
        const guest = await attach(id)
        guest.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) })
      },
      attach: async (id) => {
        await attach(id)
      },
      detach,
      detachAll: () => {
        for (const [id, entry] of attached) if (entry.owner === owner) detach(id)
      },
      executeCdp: async (id, method, command = {}, childSessionId, childTargetId) => {
        const guest = await attach(id)
        if (childTargetId) {
          const entry = [...(childSessions.get(id)?.entries() ?? [])].find(
            ([, info]) => info.targetId === childTargetId
          )
          if (!entry) throw new Error('Target is outside this tab')
          childSessionId = entry[0]
        }
        if (childSessionId && !childSessions.get(id)?.has(childSessionId))
          throw new Error('Child session is outside this tab')
        // Never expose Electron's shell, other renderers, or browser-global CDP operations.
        if (method === 'Target.getTargets') {
          const info = await guest.debugger.sendCommand('Target.getTargetInfo')
          return {
            targetInfos: [
              { ...info.targetInfo, tabId: id },
              ...[...(childSessions.get(id)?.values() ?? [])].map((target) => ({
                ...target,
                tabId: id
              }))
            ]
          }
        }
        if (!childSessionId && (method === 'Target.closeTarget' || method === 'Page.close')) {
          const info = await guest.debugger.sendCommand('Target.getTargetInfo')
          if (command.targetId !== undefined && command.targetId !== info.targetInfo.targetId)
            throw new Error('Target is outside this tab')
          detach(id)
          await request({ method: 'close', tabId: id })
          return { success: true }
        }
        // Electron owns guest navigation; use its navigation controller rather than
        // letting browser-level CDP history operations affect the embedder.
        if (!childSessionId && method === 'Page.reload') {
          if (command.ignoreCache === true) guest.reloadIgnoringCache()
          else guest.reload()
          return {}
        }
        if (!childSessionId && method === 'Page.printToPDF') {
          const data = await guest.printToPDF({
            landscape: command.landscape === true,
            printBackground: command.printBackground !== false,
            preferCSSPageSize: command.preferCSSPageSize === true
          })
          assertOpen()
          return { data: data.toString('base64') }
        }
        if (!childSessionId && method === 'Page.getNavigationHistory') {
          return {
            currentIndex: guest.navigationHistory.getActiveIndex(),
            entries: guest.navigationHistory.getAllEntries().map((entry, index) => ({
              id: index,
              url: entry.url,
              userTypedURL: entry.url,
              title: entry.title,
              transitionType: 'link'
            }))
          }
        }
        if (!childSessionId && method === 'Page.navigateToHistoryEntry') {
          const index = command.entryId
          if (
            typeof index !== 'number' ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= guest.navigationHistory.length()
          )
            throw new Error('Invalid navigation entry')
          guest.navigationHistory.goToIndex(index)
          return {}
        }
        if (method === 'Page.bringToFront') {
          await request({ method: 'activate', tabId: id })
          return {}
        }
        if (
          method === 'Page.navigate' &&
          (typeof command.url !== 'string' ||
            (!isBrowserPageUrl(command.url) && command.url !== 'about:blank'))
        ) {
          throw new Error('Unsupported browser navigation URL')
        }
        const domains = new Set([
          'Accessibility',
          'DOM',
          'DOMSnapshot',
          'CSS',
          'Runtime',
          'Page',
          'Input',
          'Network',
          'Fetch',
          'Emulation',
          'Performance',
          'Log',
          'Overlay'
        ])
        const targetMethods = new Set([
          'Target.getTargetInfo',
          'Target.setAutoAttach',
          'Target.attachToTarget',
          'Target.detachFromTarget'
        ])
        if (!domains.has(method.split('.')[0]) && !targetMethods.has(method))
          throw new Error(`Unsupported CDP method: ${method}`)
        if (method === 'Target.getTargetInfo' && command.targetId) {
          const info = childSessionId
            ? { targetInfo: childSessions.get(id)?.get(childSessionId) }
            : await guest.debugger.sendCommand('Target.getTargetInfo')
          if (command.targetId !== info.targetInfo?.targetId)
            throw new Error('Target is outside this tab')
        }
        if (method === 'Target.setAutoAttach') {
          if (command.flatten !== true)
            throw new Error('Iframe attachment requires flattened sessions')
          command = { ...command, filter: [{ type: 'iframe', exclude: false }] }
        }
        if (method === 'Target.attachToTarget') {
          if (command.flatten !== true)
            throw new Error('Iframe attachment requires flattened sessions')
          if (
            ![...(childSessions.get(id)?.values() ?? [])].some(
              (info) => info.targetId === command.targetId
            )
          )
            throw new Error('Target is outside this tab')
        }
        if (method === 'Target.detachFromTarget') {
          const entry = [...(childSessions.get(id)?.entries() ?? [])].find(
            ([session, info]) => command.sessionId === session || command.targetId === info.targetId
          )
          if (!entry) throw new Error('Child session is outside this tab')
          command = { sessionId: entry[0] }
        }
        if (method === 'DOM.setFileInputFiles') {
          if (
            !Array.isArray(command.files) ||
            command.files.some((path) => typeof path !== 'string' || !isAbsolute(path))
          )
            throw new Error('File upload requires absolute local file paths')
          for (const path of command.files) {
            if (!(await stat(path)).isFile()) throw new Error('File upload requires regular files')
          }
        }
        if (!method.startsWith('Input.') && method !== 'DOM.focus') {
          return guest.debugger.sendCommand(method, command, childSessionId)
        }
        const renderer = guest.hostWebContents
        const run = async (): Promise<BrowserCdpParams> => {
          assertOpen()
          const focusToken = randomUUID()
          try {
            await ui(
              scope,
              {
                method: 'preserve-focus',
                focusToken,
                tabId: id,
                focusGuest: method.startsWith('Input.')
              },
              owner,
              renderer
            )
            assertOpen()
            return await guest.debugger.sendCommand(method, command, childSessionId)
          } finally {
            // Focus cleanup belongs to the original renderer, including on failure
            // or revocation. It must not reopen a pane or require browser permission.
            if (!stopped && !renderer.isDestroyed()) {
              await ui(scope, { method: 'release-focus', focusToken }, owner, renderer)
            }
          }
        }
        // Concurrent tools must not capture another command's temporary guest focus.
        const previous = focusQueues.get(renderer.id) ?? Promise.resolve({})
        const task = previous.then(run, run)
        focusQueues.set(renderer.id, task)
        const cleanup = (): void => {
          if (focusQueues.get(renderer.id) === task) focusQueues.delete(renderer.id)
        }
        void task.then(cleanup, cleanup)
        return task
      },
      allowDownload: async (id, url) => {
        await attach(id)
        await downloadManager().allow(id, url)
      },
      waitForDownload: async (id, timeoutMs) => {
        await attach(id)
        return downloadManager().wait(id, timeoutMs)
      },
      listDownloads: async (id) => {
        await guestForId(id)
        return downloads?.list(id) ?? []
      },
      close: () => {
        if (closed) return
        closed = true
        downloads?.close()
        client.detachAll()
        for (const [id, entry] of pending)
          if (entry.owner === owner) finishUi(id, new Error('Browser session closed'))
        clients.delete(client)
      }
    }
    clients.add(client)
    return client
  }

  ipcMain.on(browserIpcChannels.automationAccept, onAccept)
  ipcMain.on(browserIpcChannels.automationReady, onReady)
  ipcMain.on(browserIpcChannels.automationResponse, onResponse)
  ipcMain.on(browserIpcChannels.automationVisibility, onVisibility)
  const close = (): void => {
    if (stopped) return
    stopped = true
    for (const client of clients) client.close()
    ipcMain.removeListener(browserIpcChannels.automationAccept, onAccept)
    ipcMain.removeListener(browserIpcChannels.automationReady, onReady)
    ipcMain.removeListener(browserIpcChannels.automationResponse, onResponse)
    ipcMain.removeListener(browserIpcChannels.automationVisibility, onVisibility)
    for (const id of pending.keys()) finishUi(id, new Error('Browser automation stopped'))
    ready.clear()
    app.removeListener('will-quit', close)
    service = undefined
  }
  service = { createClient, close }
  app.once('will-quit', close)
  return service
}

const appSession = (): Electron.Session => session.fromPartition('persist:sele-browser')
