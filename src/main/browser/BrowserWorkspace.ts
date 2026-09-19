import { randomInt } from 'node:crypto'
import {
  isBrowserPageUrl,
  type BrowserAutomationScope,
  type BrowserAutomationTab
} from '../../shared/browser'
import { BrowserAccessibility, type BrowserTreeOptions } from './BrowserAccessibility'
import type {
  BrowserAutomationClient,
  BrowserAutomationService,
  BrowserCdpEvent,
  BrowserCdpParams
} from './BrowserAutomation'
import {
  clickBrowserPoint,
  pressBrowserKeys,
  type BrowserCdpCommand,
  type BrowserPoint
} from './BrowserInput'

type ConsoleEntry = { level: string; text: string; timestamp?: number }
const isExpectedNavigationContextReplacement = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : ''
  return /execution context was destroyed|cannot find context with specified id/i.test(message)
}
type NetworkEntry = {
  requestId: string
  url: string
  method: string
  status?: number
  type?: string
  error?: string
}
type Page = {
  cdp: BrowserCdpCommand
  accessibility: BrowserAccessibility
  ready: Promise<void>
  console: ConsoleEntry[]
  network: Map<string, NetworkEntry>
}
export type BrowserComputerAction = {
  action:
    | 'screenshot'
    | 'left_click'
    | 'right_click'
    | 'middle_click'
    | 'double_click'
    | 'triple_click'
    | 'hover'
    | 'type'
    | 'key'
    | 'scroll'
    | 'scroll_to'
    | 'wait'
    | 'left_click_drag'
    | 'zoom'
  coordinate?: BrowserPoint
  startCoordinate?: BrowserPoint
  ref?: string
  text?: string
  duration?: number
  scrollDirection?: 'up' | 'down' | 'left' | 'right'
  scrollAmount?: number
  scale?: number
  region?: [number, number, number, number]
}
export type BrowserScreenshot = {
  data: string
  mimeType: 'image/png'
  width: number
  height: number
}

// Mint refs across workspaces and queries so an old ref cannot alias a newly read element.
let nextReference = randomInt(1_000_000_000)

/** Browser operations, independent of tool names, MCP, and provider lifecycle. */
export class BrowserWorkspace {
  readonly client: BrowserAutomationClient
  private pages = new Map<number, Page>()
  private closed = false
  private queue: Promise<unknown> = Promise.resolve()
  private controller = new AbortController()

  constructor(service: BrowserAutomationService, scope: BrowserAutomationScope) {
    this.client = service.createClient(scope, (event) => this.onEvent(event))
  }

  // A multi-step page action must not interleave with another action on this workspace.
  run<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(() => {
      this.assertOpen()
      return action()
    })
    this.queue = task.catch((error) => {
      console.error('[caught:BrowserWorkspace:run]', error)
    })
    return task
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    this.client.close()
    this.pages.clear()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Browser session closed')
  }

  private onEvent(event: BrowserCdpEvent): void {
    const page = this.pages.get(event.tabId)
    if (!page) return
    if (event.type === 'detach') {
      page.accessibility.clear()
      this.pages.delete(event.tabId)
      return
    }
    const params = event.params
    if (
      event.method === 'Page.frameNavigated' &&
      !(params.frame as { parentId?: string })?.parentId
    ) {
      page.accessibility.clear()
    }
    if (event.method === 'Runtime.consoleAPICalled') {
      const args = params.args as { value?: unknown; description?: string }[]
      page.console.push({
        level: String(params.type),
        text: args
          .map((arg) =>
            typeof arg.value === 'string'
              ? arg.value
              : arg.value !== undefined
                ? JSON.stringify(arg.value)
                : (arg.description ?? '')
          )
          .join(' ')
          .slice(0, 10000),
        timestamp: params.timestamp as number
      })
    }
    if (event.method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails as {
        text: string
        exception?: { description?: string }
      }
      page.console.push({
        level: 'error',
        text: (details.exception?.description ?? details.text).slice(0, 10000)
      })
    }
    if (page.console.length > 200) page.console.splice(0, page.console.length - 200)
    if (event.method === 'Network.requestWillBeSent') {
      const request = params.request as { url: string; method: string }
      const requestId = String(params.requestId)
      page.network.set(requestId, {
        requestId,
        url: request.url,
        method: request.method,
        type: params.type as string
      })
      if (page.network.size > 200) page.network.delete(page.network.keys().next().value!)
    }
    if (event.method === 'Network.responseReceived') {
      const entry = page.network.get(String(params.requestId))
      if (entry) entry.status = (params.response as { status: number }).status
    }
    if (event.method === 'Network.loadingFailed') {
      const entry = page.network.get(String(params.requestId))
      if (entry) entry.error = String(params.errorText)
    }
  }

  async tab(id?: number, create = false): Promise<BrowserAutomationTab> {
    this.assertOpen()
    const tabs = await this.client.listTabs()
    const tab =
      id === undefined
        ? (tabs.find((tab) => tab.active) ?? tabs[0])
        : tabs.find((tab) => tab.id === id)
    if (tab) return tab
    if (id !== undefined) throw new Error('Tab is outside this browser workspace')
    if (create) return this.client.createTab()
    throw new Error('No browser tab is open; call tabs_create or navigate first')
  }

  private async page(id?: number): Promise<{ id: number; page: Page }> {
    const tab = await this.tab(id)
    if (tab.url !== 'about:blank' && !isBrowserPageUrl(tab.url))
      throw new Error('This tab is not a web page')
    let page = this.pages.get(tab.id)
    if (!page) {
      const cdp: BrowserCdpCommand = async <T>(
        method: string,
        params?: BrowserCdpParams
      ): Promise<T> => {
        this.assertOpen()
        return (await this.client.executeCdp(tab.id, method, params)) as T
      }
      page = {
        cdp,
        accessibility: new BrowserAccessibility(cdp, () => `ref_${++nextReference}`),
        console: [],
        network: new Map(),
        ready: Promise.resolve()
      }
      this.pages.set(tab.id, page)
      page.ready = (async () => {
        await cdp('Page.enable')
        await cdp('Runtime.enable')
        await cdp('DOM.enable')
        await cdp('Network.enable', { maxTotalBufferSize: 5000000, maxResourceBufferSize: 1000000 })
        await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
      })()
    }
    try {
      await page.ready
    } catch (error) {
      this.pages.delete(tab.id)
      this.client.detach(tab.id)
      throw error
    }
    return { id: tab.id, page }
  }

  async createTab(url?: string, foreground = false): Promise<BrowserAutomationTab> {
    if (url && !isBrowserPageUrl(url) && url !== 'about:blank')
      throw new Error('Unsupported browser navigation URL')
    const tab = await this.client.createTab({ foreground })
    if (url) await this.navigate(url, tab.id)
    if (foreground) {
      await this.client.activateTab(tab.id)
      await this.client.visibility(true)
    }
    return this.tab(tab.id)
  }

  async selectTab(id: number): Promise<void> {
    await this.client.activateTab(id)
    await this.client.visibility(true)
  }

  async navigate(url: string, id?: number): Promise<BrowserAutomationTab> {
    if (!['back', 'forward', 'about:blank'].includes(url) && !isBrowserPageUrl(url))
      throw new Error('Unsupported browser navigation URL')
    const tab = await this.tab(id, !['back', 'forward'].includes(url))
    const { page } = await this.page(tab.id)
    page.accessibility.clear()
    if (url === 'back' || url === 'forward') {
      const history = await page.cdp<{ currentIndex: number; entries: { id: number }[] }>(
        'Page.getNavigationHistory'
      )
      const target = history.entries[history.currentIndex + (url === 'back' ? -1 : 1)]
      if (!target) throw new Error(`No ${url} history entry`)
      await page.cdp('Page.navigateToHistoryEntry', { entryId: target.id })
    } else {
      const result = await page.cdp<{ errorText?: string }>('Page.navigate', { url })
      if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`)
    }
    // Bound readiness; a page may keep loading indefinitely. Later calls can read its current state.
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      await this.delay(50)
      try {
        if (await this.evaluateOn(page, 'document.readyState !== "loading"')) break
      } catch (error) {
        if (!isExpectedNavigationContextReplacement(error)) {
          console.error('[caught:BrowserWorkspace:navigate]', error)
        }
        /* A navigation may replace the execution context between polls. */
      }
    }
    return this.tab(tab.id)
  }

  private async evaluateOn<T>(page: Page, expression: string): Promise<T> {
    const result = await page.cdp<{
      result: { value: T; unserializableValue?: string }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      timeout: 10000
    })
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      )
    return result.result.value ?? (result.result.unserializableValue as T)
  }

  async evaluate(expression: string, id?: number): Promise<unknown> {
    return this.evaluateOn((await this.page(id)).page, expression)
  }

  async readPage(options: BrowserTreeOptions = {}, id?: number): Promise<string> {
    return (await this.page(id)).page.accessibility.read(options)
  }

  async find(query: string, id?: number): Promise<string> {
    return (await this.page(id)).page.accessibility.read({}, query)
  }

  async text(id?: number): Promise<string> {
    return this.evaluate(
      '(document.querySelector("article, main") || document.body)?.innerText?.slice(0, 50000) || ""',
      id
    ) as Promise<string>
  }

  async fill(ref: string, value: string | number | boolean, id?: number): Promise<void> {
    await (await this.page(id)).page.accessibility.fill(ref, value)
  }

  private async viewport(page: Page): Promise<{ width: number; height: number }> {
    return this.evaluateOn(page, '({width:innerWidth,height:innerHeight})')
  }

  private async point(
    page: Page,
    action: Pick<BrowserComputerAction, 'ref' | 'coordinate'>
  ): Promise<BrowserPoint> {
    if (action.ref && action.coordinate)
      throw new Error('Provide either ref or coordinate, not both')
    const point = action.ref ? await page.accessibility.point(action.ref) : action.coordinate
    if (!point) throw new Error('This action requires a ref or coordinate')
    const { width, height } = await this.viewport(page)
    if (
      !point.every(Number.isFinite) ||
      point[0] < 0 ||
      point[1] < 0 ||
      point[0] >= width ||
      point[1] >= height
    )
      throw new Error('Coordinates are outside the viewport')
    return point
  }

  async screenshot(
    id?: number,
    scale = 1,
    region?: [number, number, number, number]
  ): Promise<BrowserScreenshot> {
    const { page } = await this.page(id)
    const { width, height } = await this.viewport(page)
    const offset = await this.evaluateOn<{ x: number; y: number }>(page, '({x:scrollX,y:scrollY})')
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 1)
      throw new Error('Invalid screenshot scale')
    const [x, y, right, bottom] = region ?? [0, 0, width, height]
    if (
      ![x, y, right, bottom].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      right > width ||
      bottom > height ||
      right <= x ||
      bottom <= y
    )
      throw new Error('Invalid screenshot region')
    const { data } = await page.cdp<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: x + offset.x, y: y + offset.y, width: right - x, height: bottom - y, scale }
    })
    return { data, mimeType: 'image/png', width, height }
  }

  private delay(ms: number): Promise<void> {
    this.assertOpen()
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        clearTimeout(timer)
        reject(new Error('Browser session closed'))
      }
      const timer = setTimeout(() => {
        this.controller.signal.removeEventListener('abort', abort)
        resolve()
      }, ms)
      this.controller.signal.addEventListener('abort', abort, { once: true })
    })
  }

  async computer(action: BrowserComputerAction, id?: number): Promise<BrowserScreenshot | void> {
    if (action.action === 'screenshot' || action.action === 'zoom') {
      if (action.action === 'zoom' && !action.region) throw new Error('Zoom requires a region')
      return this.screenshot(id, action.scale, action.region)
    }
    if (action.action === 'wait') {
      if (
        action.duration === undefined ||
        !Number.isFinite(action.duration) ||
        action.duration < 0 ||
        action.duration > 10
      )
        throw new Error('Wait duration must be between 0 and 10 seconds')
      await this.delay(action.duration * 1000)
      return
    }
    const { page } = await this.page(id)
    switch (action.action) {
      case 'type':
        if (action.text === undefined) throw new Error('Type requires text')
        await page.cdp('Input.insertText', { text: action.text })
        return
      case 'key':
        if (!action.text) throw new Error('Key requires text')
        await pressBrowserKeys(page.cdp, action.text)
        return
      case 'scroll_to':
        if (!action.ref) throw new Error('Scroll to requires ref')
        await page.accessibility.point(action.ref)
        return
      case 'scroll': {
        if (!action.scrollDirection) throw new Error('Scroll requires scroll_direction')
        const [x, y] = await this.point(page, action)
        const amount = (action.scrollAmount ?? 3) * 100
        const sign = ['up', 'left'].includes(action.scrollDirection) ? -1 : 1
        await page.cdp('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX: ['left', 'right'].includes(action.scrollDirection) ? amount * sign : 0,
          deltaY: ['up', 'down'].includes(action.scrollDirection) ? amount * sign : 0
        })
        return
      }
      case 'hover': {
        const [x, y] = await this.point(page, action)
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        return
      }
      case 'left_click_drag': {
        if (!action.startCoordinate) throw new Error('Drag requires start_coordinate')
        const [x, y] = await this.point(page, action)
        const [startX, startY] = await this.point(page, { coordinate: action.startCoordinate })
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY })
        await page.cdp('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: startX,
          y: startY,
          button: 'left',
          clickCount: 1
        })
        try {
          for (let step = 1; step <= 5; step++)
            await page.cdp('Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: startX + ((x - startX) * step) / 5,
              y: startY + ((y - startY) * step) / 5,
              button: 'left',
              buttons: 1
            })
        } finally {
          await page.cdp('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1
          })
        }
        return
      }
      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click':
      case 'triple_click':
        await clickBrowserPoint(
          page.cdp,
          await this.point(page, action),
          action.action === 'right_click'
            ? 'right'
            : action.action === 'middle_click'
              ? 'middle'
              : 'left',
          action.action === 'double_click' ? 2 : action.action === 'triple_click' ? 3 : 1
        )
        return
      default:
        throw new Error('Unsupported browser input action')
    }
  }

  async resize(
    options: {
      width?: number
      height?: number
      preset?: 'mobile' | 'tablet' | 'desktop'
      colorScheme?: 'light' | 'dark'
    },
    id?: number
  ): Promise<void> {
    const { page } = await this.page(id)
    if (options.preset === 'desktop') await page.cdp('Emulation.clearDeviceMetricsOverride')
    else if (options.preset || options.width !== undefined || options.height !== undefined) {
      const [width, height] =
        options.preset === 'mobile'
          ? [375, 812]
          : options.preset === 'tablet'
            ? [768, 1024]
            : [options.width, options.height]
      if (
        !width ||
        !height ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 4096 ||
        height > 4096
      )
        throw new Error('Provide width and height between 1 and 4096')
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      })
    }
    if (options.colorScheme)
      await page.cdp('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: options.colorScheme }]
      })
  }

  async consoleMessages(
    options: { onlyErrors?: boolean; pattern?: string; limit?: number },
    id?: number
  ): Promise<ConsoleEntry[]> {
    const { page } = await this.page(id)
    return page.console
      .filter(
        (entry) =>
          (!options.onlyErrors || entry.level === 'error') &&
          (!options.pattern || entry.text.includes(options.pattern))
      )
      .slice(-(options.limit ?? 50))
  }

  async networkRequests(
    options: { urlPattern?: string; requestId?: string; limit?: number },
    id?: number
  ): Promise<unknown> {
    const { page } = await this.page(id)
    if (options.requestId) {
      if (!page.network.has(options.requestId))
        throw new Error('Request was not observed in this tab')
      return page.cdp('Network.getResponseBody', { requestId: options.requestId })
    }
    return [...page.network.values()]
      .filter((entry) => !options.urlPattern || entry.url.includes(options.urlPattern))
      .slice(-(options.limit ?? 50))
  }
}
