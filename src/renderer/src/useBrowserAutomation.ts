import { useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { WebviewTag } from 'electron'
import type {
  BrowserAutomationRequest,
  BrowserAutomationResponse,
  BrowserAutomationTab
} from '../../shared/browser'
import { browserApi } from './browserApi'

type Tab = {
  id: string
  initialUrl: string
  loaded: boolean
  title: string
  url: string
  error: string | null
}
type Workspace = { activeTabId: string | null; tabs: Tab[] }

type Options = {
  active: boolean
  view: 'global' | 'project' | 'chat'
  workspaces: Map<string, Workspace>
  setWorkspaces: Dispatch<SetStateAction<Map<string, Workspace>>>
  webviews: React.RefObject<Map<string, WebviewTag>>
  showWorkspace: (key: string) => void
}

export function useBrowserAutomation(options: Options): void {
  const current = useRef(options)
  useLayoutEffect(() => {
    current.current = options
  })

  useEffect(() => {
    let mounted = true
    const inFlight = new Set<string>()
    const workspaceKey = (request: BrowserAutomationRequest): string => {
      const { scope } = request
      switch (current.current.view) {
        case 'global':
          return 'global'
        case 'chat':
          return `chat:${scope.providerId}:${scope.sessionId}`
        case 'project':
          return `project:${scope.containerKey}\0${scope.cwd}`
      }
    }
    const readTabs = (key: string): BrowserAutomationTab[] => {
      const workspace = current.current.workspaces.get(key)
      return (workspace?.tabs ?? []).flatMap((tab) => {
        const element = current.current.webviews.current.get(tab.id)
        if (!element) return []
        try {
          return [
            {
              id: element.getWebContentsId(),
              title: element.getTitle() || tab.title,
              url: element.getURL() || tab.url || 'about:blank',
              active: workspace?.activeTabId === tab.id
            }
          ]
        } catch (error) {
          console.error('[caught:useBrowserAutomation:readTabs]', error)
          return []
        }
      })
    }
    const waitForTabs = async (
      key: string,
      requiredId?: string
    ): Promise<BrowserAutomationTab[]> => {
      const deadline = Date.now() + 10000
      while (mounted && Date.now() < deadline) {
        const workspace = current.current.workspaces.get(key)
        const live = readTabs(key)
        if (
          workspace &&
          (!requiredId || workspace.tabs.some((tab) => tab.id === requiredId)) &&
          live.length === workspace.tabs.length
        )
          return live
        await new Promise<void>((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Browser tab did not attach')
    }
    const handle = async (
      request: BrowserAutomationRequest
    ): Promise<BrowserAutomationResponse['result']> => {
      const key = workspaceKey(request)
      const state = current.current
      if (request.method === 'visibility') {
        if (request.visible !== undefined) browserApi.setAutomationVisible(request.visible)
        return { visible: request.visible ?? state.active }
      }
      if (request.method === 'list' || request.method === 'create') {
        const tab: Tab | undefined =
          request.method === 'create'
            ? {
                id: crypto.randomUUID(),
                initialUrl: 'about:blank',
                loaded: true,
                title: 'New tab',
                url: 'about:blank',
                error: null
              }
            : undefined
        state.setWorkspaces((workspaces) => {
          const workspace = workspaces.get(key) ?? { tabs: [], activeTabId: null }
          if (
            !tab &&
            workspaces.has(key) &&
            workspace.tabs.every((item) => item.loaded && item.url)
          )
            return workspaces
          const tabs = workspace.tabs.map((item) => ({
            ...item,
            loaded: true,
            url: item.url || 'about:blank',
            initialUrl: item.initialUrl || 'about:blank'
          }))
          if (tab) tabs.push(tab)
          return new Map(workspaces).set(key, {
            tabs,
            activeTabId:
              tab && (request.foreground !== false || !workspace.activeTabId)
                ? tab.id
                : workspace.activeTabId
          })
        })
        if (tab && request.foreground !== false) state.showWorkspace(key)
        const live = await waitForTabs(key, tab?.id)
        if (!tab) return live
        const element = current.current.webviews.current.get(tab.id)
        return live.find((item) => item.id === element?.getWebContentsId())!
      }
      const workspace = state.workspaces.get(key)
      const tab = workspace?.tabs.find((item) => {
        try {
          return state.webviews.current.get(item.id)?.getWebContentsId() === request.tabId
        } catch (error) {
          console.error('[caught:useBrowserAutomation:handle]', error)
          return false
        }
      })
      if (!workspace || !tab) throw new Error('Tab is not in this browser workspace')
      if (request.method === 'activate') {
        state.showWorkspace(key)
        state.setWorkspaces((workspaces) => {
          const latest = workspaces.get(key)
          if (!latest?.tabs.some((item) => item.id === tab.id)) return workspaces
          return new Map(workspaces).set(key, { ...latest, activeTabId: tab.id })
        })
      } else if (request.method === 'close') {
        state.setWorkspaces((workspaces) => {
          const latest = workspaces.get(key)
          if (!latest) return workspaces
          const tabs = latest.tabs.filter((item) => item.id !== tab.id)
          return new Map(workspaces).set(key, {
            tabs,
            activeTabId: latest.activeTabId === tab.id ? (tabs[0]?.id ?? null) : latest.activeTabId
          })
        })
      }
      return null
    }
    const unsubscribe = browserApi.onAutomationRequest((request) => {
      if (inFlight.has(request.id)) return
      inFlight.add(request.id)
      void handle(request)
        .then(
          (result) => {
            if (mounted) browserApi.automationRespond({ id: request.id, result })
          },
          (error: unknown) => {
            console.error('[useBrowserAutomation:handle] Automation request failed', error)
            if (mounted)
              browserApi.automationRespond({
                id: request.id,
                error: error instanceof Error ? error.message : String(error)
              })
          }
        )
        .finally(() => inFlight.delete(request.id))
    })
    browserApi.automationReady(true)
    return () => {
      mounted = false
      unsubscribe()
      browserApi.automationReady(false)
    }
  }, [])
}
