import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  ExternalLink,
  Keyboard,
  Plus,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { appApi } from '../appApi'
import type { LocalAccessApi } from '../../../shared/localAccess'
import type { RemoteBrowserRequest, RemoteBrowserState } from '../../../shared/remoteBrowser'
import { normalizeBrowserAddress } from '../../../shared/browser'
import { Button } from './Button'
import { Input } from './Input'
import './RemoteBrowserPanel.css'

export function RemoteBrowserPanel({
  active,
  workspaceKey,
  cwd,
  openRequest
}: {
  active: boolean
  workspaceKey: string
  cwd: string
  openRequest?: { id: string; url: string } | null
}): React.ReactElement {
  const [state, setState] = useState<RemoteBrowserState>({ tabs: [] })
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [tabId, setTabId] = useState<number>()
  const viewId = useRef(crypto.randomUUID())
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressForm = useRef<HTMLFormElement>(null)
  const alive = useRef(false)
  const composing = useRef(false)
  const handledOpen = useRef<string | undefined>(undefined)
  const pointer = useRef<{
    x: number
    y: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)
  const wheel = useRef<{
    delta: number
    x: number
    y: number
    timer: ReturnType<typeof setTimeout> | null
  }>({ delta: 0, x: 0, y: 0, timer: null })
  const current =
    state.tabs.find((tab) => tab.id === tabId) ??
    state.tabs.find((tab) => tab.active) ??
    state.tabs[0]
  const selectedTab = useRef(tabId)
  selectedTab.current = tabId
  const request = useCallback(
    (method: RemoteBrowserRequest['method'], values: Partial<RemoteBrowserRequest> = {}) =>
      (window as unknown as { localAccessApi: LocalAccessApi }).localAccessApi.remoteBrowser({
        viewId: viewId.current,
        workspaceKey,
        cwd,
        method,
        tabId: selectedTab.current,
        ...values
      }),
    [workspaceKey, cwd]
  )
  const refresh = useCallback(async () => {
    const value = await request('state')
    if (value && alive.current) {
      setState(value)
      setError(null)
    }
  }, [request])
  const act = useCallback(
    async (
      method: RemoteBrowserRequest['method'],
      values: Partial<RemoteBrowserRequest> = {}
    ): Promise<void> => {
      setBusy(true)
      try {
        await request(method, values)
        await refresh()
      } catch (error) {
        console.warn('Unable to update the host browser.', error)
        if (alive.current) setError(error instanceof Error ? error.message : String(error))
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [request, refresh]
  )
  useEffect(() => {
    if (!active) return
    if (releaseTimer.current) clearTimeout(releaseTimer.current)
    alive.current = true
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      let delay = 750
      try {
        await refresh()
      } catch (error) {
        if (stopped) return
        console.warn('Unable to view the host browser.', error)
        if (!stopped) setError(error instanceof Error ? error.message : String(error))
        delay = 5000
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), delay)
      }
    }
    void poll()
    return () => {
      alive.current = false
      stopped = true
      clearTimeout(timer)
      if (wheel.current.timer) clearTimeout(wheel.current.timer)
      releaseTimer.current = setTimeout(() => {
        void request('release').catch((error) =>
          console.warn('Unable to release the phone browser view.', error)
        )
      }, 0)
    }
  }, [active, request, refresh])
  useEffect(() => {
    setAddress(current?.url === 'about:blank' ? '' : (current?.url ?? ''))
  }, [current?.url])
  useEffect(() => {
    if (!active || !openRequest || handledOpen.current === openRequest.id) return
    handledOpen.current = openRequest.id
    void (async () => {
      try {
        if (!current) await request('create')
        await act('navigate', { url: openRequest.url })
      } catch (error) {
        console.warn('Unable to open a browser link.', error)
        setError(String(error))
      }
    })()
  }, [active, openRequest, current, request, act])
  const point = (event: React.PointerEvent<HTMLImageElement>): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        ((event.clientX - bounds.left) * (state.frame?.width ?? bounds.width)) / bounds.width
      ),
      y: Math.max(
        0,
        ((event.clientY - bounds.top) * (state.frame?.height ?? bounds.height)) / bounds.height
      )
    }
  }
  const queueScroll = (delta: number, x: number, y: number): void => {
    wheel.current.delta += delta
    wheel.current.x = x
    wheel.current.y = y
    if (wheel.current.timer) return
    wheel.current.timer = setTimeout(() => {
      const { delta, x, y } = wheel.current
      wheel.current.delta = 0
      wheel.current.timer = null
      void request('scroll', { deltaY: Math.max(-5000, Math.min(5000, delta)), x, y }).catch(
        (error) => {
          console.warn('Unable to scroll the host browser.', error)
          setError(String(error))
        }
      )
    }, 60)
  }
  const typeText = (input: HTMLInputElement, inputType?: string): void => {
    if (composing.current) return
    const text = input.value
    input.value = ''
    if (text) void act('text', { text })
    else if (inputType === 'deleteContentBackward') void act('key', { key: 'Backspace' })
  }
  return (
    <section className="remote-browser" aria-label="Browser on your computer">
      <div className="remote-browser__tabs" role="tablist" aria-label="Browser tabs">
        {state.tabs.map((tab) => (
          <div className="remote-browser__tab" key={tab.id}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === current?.id}
              onClick={() => {
                setTabId(tab.id)
                void act('activate', { tabId: tab.id })
              }}
            >
              {tab.title || 'New tab'}
            </button>
            <Button
              aria-label={`Close ${tab.title || 'tab'}`}
              icon={<X size={14} />}
              theme="transparent"
              callback={() => {
                if (tab.id === current?.id) setTabId(undefined)
                return act('close', { tabId: tab.id })
              }}
            />
          </div>
        ))}
        <Button
          aria-label="New browser tab"
          icon={<Plus size={18} />}
          theme="transparent"
          disabled={busy}
          callback={() => {
            setTabId(undefined)
            return act('create')
          }}
        />
      </div>
      <form
        ref={addressForm}
        className="remote-browser__address"
        onSubmit={(event) => {
          event.preventDefault()
          void (async () => {
            const url = normalizeBrowserAddress(address)
            if (!url) throw new Error('Enter a web address.')
            if (!current) await request('create')
            await act('navigate', { url })
          })().catch((error) => {
            console.warn('Unable to navigate the host browser.', error)
            setError(String(error))
          })
        }}
      >
        <Input
          aria-label="Browser address"
          value={address}
          placeholder="Search or enter address"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setAddress(event.currentTarget.value)}
        />
        <Button
          aria-label="Go to address"
          icon={<CornerDownLeft size={18} />}
          theme="secondary"
          disabled={busy}
          callback={() => addressForm.current?.requestSubmit()}
        />
      </form>
      <div className="remote-browser__controls" role="toolbar" aria-label="Browser navigation">
        <Button
          aria-label="Back"
          icon={<ArrowLeft size={18} />}
          theme="transparent"
          disabled={!state.frame?.canGoBack || busy}
          callback={() => act('back')}
        />
        <Button
          aria-label="Forward"
          icon={<ArrowRight size={18} />}
          theme="transparent"
          disabled={!state.frame?.canGoForward || busy}
          callback={() => act('forward')}
        />
        <Button
          aria-label="Reload page"
          icon={<RefreshCw size={18} />}
          theme="transparent"
          disabled={!current || busy}
          callback={() => act('reload')}
        />
        <Button
          aria-label="Keyboard"
          icon={<Keyboard size={18} />}
          theme="transparent"
          disabled={!current}
          aria-pressed={typing}
          callback={() => setTyping((value) => !value)}
        />
        <Button
          aria-label={zoomed ? 'Fit page' : 'Zoom page'}
          icon={zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
          theme="transparent"
          callback={() => setZoomed((value) => !value)}
        />
        <Button
          aria-label="Scroll page up"
          icon={<ArrowUp size={18} />}
          theme="transparent"
          disabled={!current}
          callback={() => act('scroll', { deltaY: -400 })}
        />
        <Button
          aria-label="Scroll page down"
          icon={<ArrowDown size={18} />}
          theme="transparent"
          disabled={!current}
          callback={() => act('scroll', { deltaY: 400 })}
        />
        <Button
          aria-label="Open on phone"
          icon={<ExternalLink size={18} />}
          theme="transparent"
          disabled={!current || !/^https?:/.test(current.url)}
          callback={async () => {
            if (current) await appApi.handleExternalLink({ url: current.url })
          }}
        />
      </div>
      {error && (
        <p className="remote-browser__error" role="alert">
          {error} <Button label="Retry" theme="secondary" callback={() => act('state')} />
        </p>
      )}
      <div className={`remote-browser__page${zoomed ? ' remote-browser__page--zoomed' : ''}`}>
        {state.frame ? (
          <img
            src={state.frame.dataUrl}
            alt={current?.title || 'Browser page'}
            draggable={false}
            onPointerDown={(event) => {
              if (event.pointerType === 'touch') event.preventDefault()
              const p = point(event)
              pointer.current = { ...p, startX: p.x, startY: p.y, moved: false }
              if (!zoomed) event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const previous = pointer.current
              if (!previous) return
              const p = point(event)
              if (Math.abs(p.y - previous.startY) > 8 || Math.abs(p.x - previous.startX) > 8)
                previous.moved = true
              if (previous.moved && !zoomed) queueScroll(previous.y - p.y, p.x, p.y)
              previous.x = p.x
              previous.y = p.y
            }}
            onPointerUp={() => {
              const previous = pointer.current
              pointer.current = null
              if (previous && !previous.moved)
                void act('click', { x: previous.startX, y: previous.startY })
            }}
            onPointerCancel={() => {
              pointer.current = null
            }}
            onWheel={(event) => queueScroll(event.deltaY, 1, 1)}
          />
        ) : (
          <div className="remote-browser__empty">
            {current ? 'Opening page…' : 'Open a tab to browse on your computer.'}
          </div>
        )}
      </div>
      {typing && (
        <div className="remote-browser__keyboard">
          <Input
            autoFocus
            aria-label="Type into page"
            placeholder="Type into the selected field"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={(event) => {
              composing.current = false
              typeText(event.currentTarget)
            }}
            onInput={(event) =>
              typeText(event.currentTarget, (event.nativeEvent as InputEvent).inputType)
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'Escape') {
                event.preventDefault()
                void act('key', { key: event.key })
              }
            }}
          />
          <div>
            {(['Tab', 'Backspace', 'Enter', 'Escape'] as const).map((key) => (
              <Button
                key={key}
                label={key}
                theme="secondary"
                onPointerDown={(event) => event.preventDefault()}
                callback={() => act('key', { key })}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
