import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { McpAppsApi, McpAppScope as AppScope, McpAppView } from '../../../shared/mcpApps'
import { appApi } from '../appApi'
import { Button } from './Button'
import './McpApp.css'

const Scope = createContext<AppScope | undefined>(undefined)
export const McpAppScope = ({ value, children }: { value?: AppScope; children: ReactNode }) => (
  <Scope value={value}>{children}</Scope>
)
const api = (): McpAppsApi => (window as unknown as { mcpAppsApi: McpAppsApi }).mcpAppsApi

type Confirmation = { title: string; detail: string; resolve(accepted: boolean): void }
export function McpApp({ callId }: { callId: string }): React.ReactElement | null {
  const scope = useContext(Scope)
  return scope ? (
    <McpAppContent
      key={`${scope.providerId}:${scope.chatId}:${callId}`}
      callId={callId}
      scope={scope}
    />
  ) : null
}
function McpAppContent({ callId, scope }: { callId: string; scope: AppScope }): React.ReactElement {
  const frame = useRef<HTMLIFrameElement>(null)
  const mounted = useRef(false)
  const currentView = useRef<McpAppView | null>(null)
  const confirmation = useRef<Confirmation | null>(null)
  const [view, setView] = useState<McpAppView | null>(null)
  const [pending, setPending] = useState<Confirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [height, setHeight] = useState(320)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      confirmation.current?.resolve(false)
      if (currentView.current) void api().close(currentView.current.id)
    }
  }, [])
  useEffect(() => {
    if (!view || !frame.current?.contentWindow) return
    let active = true
    const element = frame.current
    const approve = (title: string, detail: string): Promise<boolean> => {
      if (confirmation.current)
        return Promise.reject(new Error('Another app action is awaiting confirmation.'))
      return new Promise((resolve) => {
        const value = {
          title,
          detail,
          resolve: (accepted: boolean) => {
            confirmation.current = null
            setPending(null)
            resolve(accepted)
          }
        }
        confirmation.current = value
        setPending(value)
      })
    }
    const bridge = new AppBridge(
      null,
      { name: 'Sele', version: '3.7.1' },
      {
        ...(view.canCall ? { serverTools: {} } : {}),
        serverResources: {},
        openLinks: {}
      },
      {
        hostContext: {
          theme: document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'light',
          locale: navigator.language,
          displayMode: 'inline',
          availableDisplayModes: ['inline'],
          platform: 'desktop',
          userAgent: 'Sele'
        }
      }
    )
    bridge.onsandboxready = () => {
      void bridge.sendSandboxResourceReady({ html: '' })
    }
    bridge.oninitialized = () => {
      void (async () => {
        await bridge.sendToolInput({ arguments: view.input })
        await bridge.sendToolResult(view.result as Parameters<typeof bridge.sendToolResult>[0])
      })().catch((reason) => {
        if (active) setError(String(reason))
      })
    }
    bridge.onsizechange = (value) => {
      if (typeof value.height === 'number' && Number.isFinite(value.height))
        setHeight(Math.max(80, Math.min(1600, value.height)))
    }
    bridge.oncalltool = async (params) => {
      if (
        !view.canCall ||
        !(await approve(
          `Allow ${view.serverName} to run ${params.name}?`,
          JSON.stringify(params.arguments ?? {}, null, 2).slice(0, 20000)
        ))
      )
        throw new Error('The app action was canceled.')
      return (await api().request(view.id, 'tools/call', {
        name: params.name,
        arguments: params.arguments ?? {}
      })) as Awaited<ReturnType<NonNullable<typeof bridge.oncalltool>>>
    }
    bridge.setRequestHandler(
      'tools/list',
      async () =>
        (await api().request(view.id, 'tools/list', {})) as Awaited<
          ReturnType<typeof bridge.listTools>
        >
    )
    bridge.onreadresource = async (params) =>
      (await api().request(view.id, 'resources/read', { uri: params.uri })) as Awaited<
        ReturnType<NonNullable<typeof bridge.onreadresource>>
      >
    bridge.onopenlink = async ({ url }) => {
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported app link.')
      if (!(await approve('Open this external link?', parsed.href))) return { isError: true }
      await appApi.handleExternalLink({ url: parsed.href, action: 'open' })
      return { isError: false }
    }
    const observe = new MutationObserver(() =>
      bridge.setHostContext({
        theme: document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'light'
      })
    )
    observe.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme']
    })
    void bridge
      .connect(new PostMessageTransport(element.contentWindow!, element.contentWindow!))
      .then(() => {
        if (active) element.src = view.url
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
    return () => {
      active = false
      observe.disconnect()
      confirmation.current?.resolve(false)
      void bridge
        .teardownResource({}, { timeout: 300 })
        .catch(() => {})
        .finally(() => bridge.close())
    }
  }, [view])
  const open = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const value = await api().open(scope, callId)
      if (!mounted.current) {
        await api().close(value.id)
        return
      }
      currentView.current = value
      setView(value)
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
            : String(reason)
        )
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <section className="mcp-app" aria-label="Interactive connector app">
      {!view ? (
        <Button
          disabled={busy}
          callback={open}
          label={busy ? 'Opening app…' : 'Open interactive app'}
          theme="secondary"
        />
      ) : (
        <>
          <div className="mcp-app__header">
            <strong>{view.serverName}</strong>
            <Button
              callback={async () => {
                await api().close(view.id)
                currentView.current = null
                setView(null)
              }}
              label="Close app"
              theme="secondary"
              size="small"
            />
          </div>
          <iframe
            ref={frame}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            title={`${view.serverName} app`}
            style={{ height }}
          />
          {pending && (
            <div
              className="mcp-app__confirmation"
              role="group"
              aria-label="App action confirmation"
            >
              <strong>{pending.title}</strong>
              <pre>{pending.detail}</pre>
              <div className="mcp-app__actions">
                <Button
                  callback={() => pending.resolve(false)}
                  label="Cancel app action"
                  theme="secondary"
                />
                <Button
                  callback={() => pending.resolve(true)}
                  label="Allow app action"
                  theme="primary"
                />
              </div>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
