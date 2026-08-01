import { useCallback, useEffect, useRef, useState } from 'react'
import type { ITheme, Terminal as XtermTerminal } from '@xterm/xterm'
import { Plus, RefreshCw, Terminal as TerminalIcon, X } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderId, ProviderWorkingToolStatus } from '../../../shared/provider'
import { providerApi } from '../providerApi'
import { terminalApi } from '../terminalApi'
import { Button } from './Button'
import { SegmentedControl } from './SegmentedControl'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'

export type TerminalLaunchRequest = {
  id: string
  providerId: ProviderId
  chatId: string
  turnId: string
  itemId: string
  processId: string
  command: string
  cwd: string | null
  output: string | null
  status: ProviderWorkingToolStatus
}

export type TerminalCommandLaunchRequest = {
  id: string
  command: string
  container: AppContainerTarget | null
  cwd: string | null
  label: string | null
  focus: boolean
  closeOnFinish: boolean
}

export type AgentTerminalSnapshot = Omit<TerminalLaunchRequest, 'id'>

type AgentTerminalIdentity = {
  providerId: ProviderId
  chatId: string
  turnId: string
  itemId: string
  processId: string
}

type TerminalPanelProps = {
  container: AppContainerTarget | null
  cwd: string | null
  commandLaunchRequest?: TerminalCommandLaunchRequest | null
  launchRequest?: TerminalLaunchRequest | null
  agentTerminalSnapshots?: AgentTerminalSnapshot[]
}

type TerminalState = 'starting' | 'running' | 'exited' | 'error'

type TerminalTab = {
  id: string
  kind: 'local'
  label: string
  container: AppContainerTarget | null
  cwd: string | null
  initialCommand: string | null
  closeOnCommandFinish: boolean
}

type AgentTerminalTab = AgentTerminalIdentity & {
  id: string
  kind: 'agent'
  label: string
  command: string
  cwd: string | null
  initialOutput: string | null
  initialStatus: ProviderWorkingToolStatus
}

type AnyTerminalTab = TerminalTab | AgentTerminalTab

type TerminalSessionProps = {
  closeOnCommandFinish: boolean
  container: AppContainerTarget | null
  cwd: string | null
  initialCommand: string | null
  label: string
  tabId: string
  visible: boolean
  onCommandFinish: (tabId: string) => void
  onStateChange: (tabId: string, state: TerminalState, sessionId: string | null) => void
}

type TerminalTabRuntime = {
  sessionId: string | null
  state: TerminalState
}

const outputPauseThreshold = 512 * 1024
const outputResumeThreshold = 64 * 1024
const truncatedToolValueMarker = '… [truncated to keep the app responsive]'

const darkTerminalTheme: ITheme = {
  background: '#121212',
  foreground: '#eeeeee',
  cursor: '#d0a07d',
  cursorAccent: '#121212',
  selectionBackground: '#7a563866',
  selectionInactiveBackground: '#7a563833',
  black: '#181818',
  red: '#f08379',
  green: '#68c58e',
  yellow: '#d8a451',
  blue: '#8db6d1',
  magenta: '#c792c7',
  cyan: '#78c6c8',
  white: '#eeeeee',
  brightBlack: '#7f7f7f',
  brightRed: '#ff9b92',
  brightGreen: '#8addaa',
  brightYellow: '#edbd6c',
  brightBlue: '#acd0e6',
  brightMagenta: '#dda9dd',
  brightCyan: '#99dfe1',
  brightWhite: '#ffffff'
}

const lightTerminalTheme: ITheme = {
  background: '#f5f5f3',
  foreground: '#272725',
  cursor: '#7a5638',
  cursorAccent: '#f5f5f3',
  selectionBackground: '#7a56384d',
  selectionInactiveBackground: '#7a563826',
  black: '#272725',
  red: '#b9473f',
  green: '#2f8f5b',
  yellow: '#936522',
  blue: '#4d6f88',
  magenta: '#865a86',
  cyan: '#347f80',
  white: '#e3e3df',
  brightBlack: '#696966',
  brightRed: '#cf6158',
  brightGreen: '#3da66d',
  brightYellow: '#ad7c34',
  brightBlue: '#6489a3',
  brightMagenta: '#9d709d',
  brightCyan: '#489697',
  brightWhite: '#ffffff'
}

const getTerminalTheme = (): ITheme =>
  document.documentElement.dataset.colorScheme === 'dark' ? darkTerminalTheme : lightTerminalTheme

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Unable to start the terminal.'

const createTerminalTab = (
  number: number,
  cwd: string | null,
  container: AppContainerTarget | null
): TerminalTab => ({
  id: crypto.randomUUID(),
  kind: 'local',
  label: `Terminal ${number}`,
  container,
  cwd,
  initialCommand: null,
  closeOnCommandFinish: false
})

const getCommandTabLabel = (command: string): string => {
  const firstLine = command.split(/\r?\n/, 1)[0]?.trim().replace(/\s+/g, ' ')

  if (!firstLine) return 'Agent command'
  return firstLine.length > 24 ? `${firstLine.slice(0, 23)}…` : firstLine
}

const createAgentTerminalTab = (request: TerminalLaunchRequest): AgentTerminalTab => ({
  id: crypto.randomUUID(),
  label: getCommandTabLabel(request.command),
  kind: 'agent',
  providerId: request.providerId,
  chatId: request.chatId,
  turnId: request.turnId,
  itemId: request.itemId,
  processId: request.processId,
  command: request.command,
  cwd: request.cwd,
  initialOutput: request.output,
  initialStatus: request.status
})

const createCommandTerminalTab = (request: TerminalCommandLaunchRequest): TerminalTab => ({
  id: crypto.randomUUID(),
  kind: 'local',
  label: request.label?.trim() || getCommandTabLabel(request.command),
  container: request.container,
  cwd: request.cwd,
  initialCommand: request.command,
  closeOnCommandFinish: request.closeOnFinish
})

const TerminalSession: React.FC<TerminalSessionProps> = ({
  closeOnCommandFinish,
  container,
  cwd,
  initialCommand,
  label,
  tabId,
  visible,
  onCommandFinish,
  onStateChange
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const visibleRef = useRef(visible)
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<TerminalState>('starting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    if (!visible) return

    const frame = requestAnimationFrame(() => {
      fitRef.current?.()
      terminalRef.current?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sessionId = crypto.randomUUID()
    let active = true
    let sessionCreated = false
    let sessionExited = false
    let outputFrame: number | null = null
    let resizeFrame: number | null = null
    let resizeObserver: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null
    let removeDataListener: (() => void) | null = null
    let removeExitListener: (() => void) | null = null
    let terminal: XtermTerminal | null = null
    let outputChunks: string[] = []
    let pendingOutputCharacters = 0
    let ptyPaused = false
    let lastColumns = 0
    let lastRows = 0

    const updateState = (nextState: TerminalState): void => {
      if (!active) return
      setState(nextState)
      onStateChange(tabId, nextState, sessionId)
    }

    updateState('starting')
    setError(null)
    host.replaceChildren()

    const setPtyPaused = (paused: boolean): void => {
      if (ptyPaused === paused) return
      ptyPaused = paused
      if (sessionCreated) terminalApi.setPaused(sessionId, paused)
    }

    const flushOutput = (): void => {
      outputFrame = null
      if (!terminal || outputChunks.length === 0) return

      const data = outputChunks.join('')
      outputChunks = []
      terminal.write(data, () => {
        pendingOutputCharacters = Math.max(0, pendingOutputCharacters - data.length)
        if (ptyPaused && pendingOutputCharacters <= outputResumeThreshold) {
          setPtyPaused(false)
        }
      })
    }

    const queueOutput = (data: string): void => {
      if (!active || !terminal || data.length === 0) return

      outputChunks.push(data)
      pendingOutputCharacters += data.length
      if (pendingOutputCharacters >= outputPauseThreshold) setPtyPaused(true)
      outputFrame ??= requestAnimationFrame(flushOutput)
    }

    const start = async (): Promise<void> => {
      try {
        const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-webgl')
        ])
        if (!active) return

        terminal = new Terminal({
          allowTransparency: false,
          convertEol: false,
          cursorBlink: true,
          cursorStyle: 'block',
          disableStdin: true,
          drawBoldTextInBrightColors: true,
          fontFamily:
            '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, Consolas, monospace',
          fontSize: 18,
          letterSpacing: 0,
          lineHeight: 1.15,
          macOptionIsMeta: true,
          minimumContrastRatio: 1,
          rightClickSelectsWord: true,
          scrollback: 5_000,
          scrollOnUserInput: true,
          theme: getTerminalTheme()
        })
        terminalRef.current = terminal

        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(host)

        try {
          const webglAddon = new WebglAddon()
          webglAddon.onContextLoss(() => {
            webglAddon.dispose()
          })
          terminal.loadAddon(webglAddon)
        } catch {
          // xterm keeps using its default DOM renderer when WebGL is unavailable.
        }

        themeObserver = new MutationObserver(() => {
          if (terminal) terminal.options.theme = getTerminalTheme()
        })
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-color-scheme']
        })

        terminal.attachCustomKeyEventHandler((event) => {
          if (event.type !== 'keydown' || !terminal) return true

          const isMac = document.documentElement.dataset.platform === 'darwin'
          const copyPressed = isMac
            ? event.metaKey && event.key.toLocaleLowerCase() === 'c'
            : event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === 'c'
          const pastePressed = isMac
            ? event.metaKey && event.key.toLocaleLowerCase() === 'v'
            : event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === 'v'

          if (copyPressed && terminal.hasSelection()) {
            void navigator.clipboard.writeText(terminal.getSelection())
            return false
          }

          if (pastePressed) {
            void navigator.clipboard
              .readText()
              .then((text) => terminal?.paste(text))
              .catch(() => {})
            return false
          }

          return true
        })

        removeDataListener = terminalApi.onData((event) => {
          if (event.sessionId === sessionId) queueOutput(event.data)
        })
        removeExitListener = terminalApi.onExit((event) => {
          if (event.sessionId !== sessionId) return

          sessionExited = true
          sessionCreated = false
          queueOutput(
            `\r\n\u001b[90m[process exited with code ${event.exitCode}${
              event.signal == null ? '' : `, signal ${event.signal}`
            }]\u001b[0m\r\n`
          )
          updateState('exited')
          if (closeOnCommandFinish) {
            window.requestAnimationFrame(() => onCommandFinish(tabId))
          }
        })

        const fitAndResize = (): void => {
          resizeFrame = null
          if (!terminal || host.clientWidth === 0 || host.clientHeight === 0) return

          fitAddon.fit()
          if (terminal.cols === lastColumns && terminal.rows === lastRows) return

          lastColumns = terminal.cols
          lastRows = terminal.rows
          if (sessionCreated) {
            terminalApi.resize(sessionId, terminal.cols, terminal.rows)
          }
        }
        fitRef.current = fitAndResize

        resizeObserver = new ResizeObserver(() => {
          if (resizeFrame == null) resizeFrame = requestAnimationFrame(fitAndResize)
        })
        resizeObserver.observe(host)

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (!active || !terminal) return
        fitAndResize()

        await terminalApi.createSession({
          sessionId,
          container,
          cwd,
          cols: terminal.cols,
          rows: terminal.rows,
          initialCommand,
          keepAliveOnCommandFinish: Boolean(initialCommand?.trim() && !closeOnCommandFinish)
        })
        if (!active) {
          await terminalApi.closeSession(sessionId)
          return
        }

        if (sessionExited) return

        sessionCreated = true
        terminal.options.disableStdin = false
        if (ptyPaused) terminalApi.setPaused(sessionId, true)
        updateState('running')

        terminal.onData((data) => {
          if (sessionCreated) terminalApi.write(sessionId, data)
        })
        if (visibleRef.current) terminal.focus()
      } catch (startError) {
        if (!active) return
        const message = getErrorMessage(startError)
        setError(message)
        updateState('error')
        terminal?.writeln(`\r\n\u001b[31m${message}\u001b[0m`)
      }
    }

    void start()

    return () => {
      active = false
      if (outputFrame != null) cancelAnimationFrame(outputFrame)
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      removeDataListener?.()
      removeExitListener?.()
      fitRef.current = null
      terminalRef.current = null
      terminal?.dispose()
      if (sessionCreated) void terminalApi.closeSession(sessionId)
    }
  }, [
    closeOnCommandFinish,
    container,
    cwd,
    generation,
    initialCommand,
    onCommandFinish,
    onStateChange,
    tabId
  ])

  return (
    <div
      className={`terminal-panel__session${visible ? ' terminal-panel__session--active' : ''}`}
      role="region"
      aria-label={label}
      hidden={!visible}
    >
      {(state === 'exited' || state === 'error') && (
        <div className="terminal-panel__restart">
          <Button
            theme="transparent"
            size="small"
            aria-label="Restart terminal"
            title={error ? `Restart terminal: ${error}` : 'Restart terminal'}
            callback={() => setGeneration((currentGeneration) => currentGeneration + 1)}
            icon={<RefreshCw aria-hidden="true" />}
          />
        </div>
      )}
      <div className="terminal-panel__surface" onPointerDown={() => terminalRef.current?.focus()}>
        <div className="terminal-panel__host" ref={hostRef} />
      </div>
    </div>
  )
}

type AgentTerminalSessionProps = AgentTerminalIdentity & {
  command: string
  initialOutput: string | null
  initialStatus: ProviderWorkingToolStatus
  label: string
  snapshot: AgentTerminalSnapshot | null
  tabId: string
  visible: boolean
  onStateChange: (tabId: string, state: TerminalState, sessionId: string | null) => void
}

const matchesAgentTerminal = (
  event: {
    providerId: ProviderId
    chatId: string
    turnId: string
    itemId: string
    processId: string | null
  },
  target: AgentTerminalIdentity
): boolean =>
  event.providerId === target.providerId &&
  event.chatId === target.chatId &&
  ((event.processId && event.processId === target.processId) ||
    (event.turnId === target.turnId && event.itemId === target.itemId))

const AgentTerminalSession: React.FC<AgentTerminalSessionProps> = ({
  providerId,
  chatId,
  turnId,
  itemId,
  processId,
  initialOutput,
  initialStatus,
  label,
  snapshot,
  tabId,
  visible,
  onStateChange
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const syncOutputRef = useRef<(output: string) => void>(() => {})
  const renderedOutputRef = useRef('')
  const statusRef = useRef<ProviderWorkingToolStatus>(initialStatus)
  const outputRef = useRef(initialOutput ?? '')
  const visibleRef = useRef(visible)
  const [state, setState] = useState<TerminalState>('starting')
  const [error, setError] = useState<string | null>(null)
  const status = snapshot?.status ?? initialStatus
  const output = snapshot?.output ?? initialOutput ?? ''

  const updateState = useCallback(
    (nextState: TerminalState): void => {
      setState(nextState)
      onStateChange(tabId, nextState, null)
    },
    [onStateChange, tabId]
  )

  useEffect(() => {
    statusRef.current = status
    if (!terminalRef.current || state === 'error') return
    terminalRef.current.options.disableStdin = true
  }, [state, status])

  useEffect(() => {
    outputRef.current = output
  }, [output])

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    if (!visible) return

    const frame = requestAnimationFrame(() => {
      fitRef.current?.()
      terminalRef.current?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    syncOutputRef.current(output)
  }, [output])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const target = { providerId, chatId, turnId, itemId, processId }
    let active = true
    let terminal: XtermTerminal | null = null
    let outputFrame: number | null = null
    let resizeFrame: number | null = null
    let resizeObserver: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null
    let removeTerminalDataListener: (() => void) | null = null
    let outputChunks: string[] = []
    let lastColumns = 0
    let lastRows = 0

    updateState('starting')
    setError(null)
    host.replaceChildren()

    const flushOutput = (): void => {
      outputFrame = null
      if (!terminal || outputChunks.length === 0) return

      const data = outputChunks.join('')
      outputChunks = []
      terminal.write(data)
    }

    const queueOutput = (data: string): void => {
      if (!active || !terminal || data.length === 0) return
      outputChunks.push(data)
      outputFrame ??= requestAnimationFrame(flushOutput)
    }

    const syncOutput = (nextOutput: string): void => {
      if (!active || !terminal) return

      const renderedOutput = renderedOutputRef.current
      if (nextOutput.startsWith(renderedOutput)) {
        const delta = nextOutput.slice(renderedOutput.length)
        renderedOutputRef.current = nextOutput
        queueOutput(delta)
        return
      }

      if (renderedOutput && nextOutput.includes(truncatedToolValueMarker)) return

      outputChunks = []
      renderedOutputRef.current = nextOutput
      terminal.reset()
      queueOutput(nextOutput)
    }

    const start = async (): Promise<void> => {
      try {
        const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-webgl')
        ])
        if (!active) return

        terminal = new Terminal({
          allowTransparency: false,
          convertEol: false,
          cursorBlink: true,
          cursorStyle: 'block',
          disableStdin: true,
          drawBoldTextInBrightColors: true,
          fontFamily:
            '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, Consolas, monospace',
          fontSize: 18,
          letterSpacing: 0,
          lineHeight: 1.15,
          macOptionIsMeta: true,
          minimumContrastRatio: 1,
          rightClickSelectsWord: true,
          scrollback: 5_000,
          scrollOnUserInput: true,
          theme: getTerminalTheme()
        })
        terminalRef.current = terminal

        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(host)

        try {
          const webglAddon = new WebglAddon()
          webglAddon.onContextLoss(() => {
            webglAddon.dispose()
          })
          terminal.loadAddon(webglAddon)
        } catch {
          // xterm keeps using its default DOM renderer when WebGL is unavailable.
        }

        themeObserver = new MutationObserver(() => {
          if (terminal) terminal.options.theme = getTerminalTheme()
        })
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-color-scheme']
        })

        terminal.attachCustomKeyEventHandler((event) => {
          if (event.type !== 'keydown' || !terminal) return true

          const isMac = document.documentElement.dataset.platform === 'darwin'
          const copyPressed = isMac
            ? event.metaKey && event.key.toLocaleLowerCase() === 'c'
            : event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === 'c'
          const pastePressed = isMac
            ? event.metaKey && event.key.toLocaleLowerCase() === 'v'
            : event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === 'v'

          if (copyPressed && terminal.hasSelection()) {
            void navigator.clipboard.writeText(terminal.getSelection())
            return false
          }

          if (pastePressed) {
            void navigator.clipboard
              .readText()
              .then((text) => terminal?.paste(text))
              .catch(() => {})
            return false
          }

          return true
        })

        const fitAndResize = (): void => {
          resizeFrame = null
          if (!terminal || host.clientWidth === 0 || host.clientHeight === 0) return

          fitAddon.fit()
          if (terminal.cols === lastColumns && terminal.rows === lastRows) return

          lastColumns = terminal.cols
          lastRows = terminal.rows
        }
        fitRef.current = fitAndResize

        resizeObserver = new ResizeObserver(() => {
          if (resizeFrame == null) resizeFrame = requestAnimationFrame(fitAndResize)
        })
        resizeObserver.observe(host)

        removeTerminalDataListener = providerApi.onAgentTerminalData((event) => {
          if (!matchesAgentTerminal(event, target) || event.source !== 'output') return
          renderedOutputRef.current = `${renderedOutputRef.current}${event.data}`
          queueOutput(event.data)
        })

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (!active || !terminal) return
        fitAndResize()
        syncOutputRef.current = syncOutput
        syncOutput(outputRef.current)
        updateState(statusRef.current === 'running' ? 'running' : 'exited')
        if (visibleRef.current) terminal.focus()
      } catch (startError) {
        if (!active) return
        const message = getErrorMessage(startError)
        setError(message)
        updateState('error')
        terminal?.writeln(`\r\n\u001b[31m${message}\u001b[0m`)
      }
    }

    void start()

    return () => {
      active = false
      if (outputFrame != null) cancelAnimationFrame(outputFrame)
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      removeTerminalDataListener?.()
      fitRef.current = null
      syncOutputRef.current = () => {}
      terminalRef.current = null
      terminal?.dispose()
    }
  }, [chatId, itemId, onStateChange, processId, providerId, tabId, turnId, updateState])

  return (
    <div
      className={`terminal-panel__session${visible ? ' terminal-panel__session--active' : ''}`}
      role="region"
      aria-label={label}
      hidden={!visible}
    >
      {state === 'error' && (
        <div className="terminal-panel__restart">
          <Button
            theme="transparent"
            size="small"
            aria-label="Terminal error"
            title={error ?? 'Terminal error'}
            disabled
            callback={() => {}}
            icon={<X aria-hidden="true" />}
          />
        </div>
      )}
      <div className="terminal-panel__surface" onPointerDown={() => terminalRef.current?.focus()}>
        <div className="terminal-panel__host" ref={hostRef} />
      </div>
    </div>
  )
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  container,
  cwd,
  commandLaunchRequest = null,
  launchRequest = null,
  agentTerminalSnapshots = []
}) => {
  const nextTabNumberRef = useRef(2)
  const closingTabsRef = useRef(new Set<string>())
  const handledCommandLaunchRequestIdsRef = useRef(
    new Set(commandLaunchRequest ? [commandLaunchRequest.id] : [])
  )
  const handledLaunchRequestIdsRef = useRef(new Set(launchRequest ? [launchRequest.id] : []))
  const tabRuntimesRef = useRef(new Map<string, TerminalTabRuntime>())
  const [workspace, setWorkspace] = useState(() => {
    const initialLocalTab = createTerminalTab(1, cwd, container)
    const tabs: AnyTerminalTab[] = [initialLocalTab]
    const initialCommandTab = commandLaunchRequest
      ? createCommandTerminalTab(commandLaunchRequest)
      : null
    const initialAgentTab = launchRequest ? createAgentTerminalTab(launchRequest) : null
    if (initialCommandTab) tabs.push(initialCommandTab)
    if (initialAgentTab) tabs.push(initialAgentTab)

    return {
      activeTabId: (initialAgentTab?.id ??
        (initialCommandTab && commandLaunchRequest?.focus ? initialCommandTab.id : null) ??
        initialLocalTab.id) as string | null,
      tabs
    }
  })

  const handleTabStateChange = useCallback(
    (tabId: string, state: TerminalState, sessionId: string | null): void => {
      tabRuntimesRef.current.set(tabId, { sessionId, state })
    },
    []
  )

  useEffect(() => {
    if (!launchRequest || handledLaunchRequestIdsRef.current.has(launchRequest.id)) return

    handledLaunchRequestIdsRef.current.add(launchRequest.id)
    const tab = createAgentTerminalTab(launchRequest)
    setWorkspace((currentWorkspace) => ({
      activeTabId:
        currentWorkspace.tabs.find(
          (currentTab) =>
            currentTab.kind === 'agent' &&
            currentTab.providerId === tab.providerId &&
            currentTab.chatId === tab.chatId &&
            currentTab.processId === tab.processId
        )?.id ?? tab.id,
      tabs: currentWorkspace.tabs.some(
        (currentTab) =>
          currentTab.kind === 'agent' &&
          currentTab.providerId === tab.providerId &&
          currentTab.chatId === tab.chatId &&
          currentTab.processId === tab.processId
      )
        ? currentWorkspace.tabs
        : [...currentWorkspace.tabs, tab]
    }))
  }, [launchRequest])

  useEffect(() => {
    if (
      !commandLaunchRequest ||
      handledCommandLaunchRequestIdsRef.current.has(commandLaunchRequest.id)
    ) {
      return
    }

    handledCommandLaunchRequestIdsRef.current.add(commandLaunchRequest.id)
    const tab = createCommandTerminalTab(commandLaunchRequest)
    setWorkspace((currentWorkspace) => ({
      activeTabId:
        commandLaunchRequest.focus || !currentWorkspace.activeTabId
          ? tab.id
          : currentWorkspace.activeTabId,
      tabs: [...currentWorkspace.tabs, tab]
    }))
  }, [commandLaunchRequest])

  const handleAddTab = (): void => {
    const tab = createTerminalTab(nextTabNumberRef.current, cwd, container)
    nextTabNumberRef.current += 1
    setWorkspace((currentWorkspace) => ({
      activeTabId: tab.id,
      tabs: [...currentWorkspace.tabs, tab]
    }))
  }

  const focusTab = (tabId: string): void => {
    setWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      activeTabId: tabId
    }))
  }

  const handleCommandFinish = useCallback((tabId: string): void => {
    tabRuntimesRef.current.delete(tabId)
    setWorkspace((currentWorkspace) => {
      const closingIndex = currentWorkspace.tabs.findIndex((currentTab) => currentTab.id === tabId)
      if (closingIndex < 0) return currentWorkspace

      return {
        activeTabId:
          currentWorkspace.activeTabId === tabId
            ? (currentWorkspace.tabs[closingIndex + 1]?.id ??
              currentWorkspace.tabs[closingIndex - 1]?.id ??
              null)
            : currentWorkspace.activeTabId,
        tabs: currentWorkspace.tabs.filter((currentTab) => currentTab.id !== tabId)
      }
    })
  }, [])

  const handleCloseTab = async (tab: AnyTerminalTab): Promise<void> => {
    if (closingTabsRef.current.has(tab.id)) return
    closingTabsRef.current.add(tab.id)

    try {
      const runtime = tabRuntimesRef.current.get(tab.id)
      if (tab.kind === 'local' && runtime?.state === 'running' && runtime.sessionId) {
        const processStatus = await terminalApi
          .getProcessStatus(runtime.sessionId)
          .catch(() => null)

        if (
          processStatus?.hasActiveProcess &&
          !window.confirm(
            processStatus.processName
              ? `${processStatus.processName} is still running in ${tab.label}. Close it anyway?`
              : `A process is still running in ${tab.label}. Close it anyway?`
          )
        ) {
          return
        }
      }

      tabRuntimesRef.current.delete(tab.id)
      setWorkspace((currentWorkspace) => {
        const closingIndex = currentWorkspace.tabs.findIndex(
          (currentTab) => currentTab.id === tab.id
        )
        if (closingIndex < 0) return currentWorkspace

        return {
          activeTabId:
            currentWorkspace.activeTabId === tab.id
              ? (currentWorkspace.tabs[closingIndex + 1]?.id ??
                currentWorkspace.tabs[closingIndex - 1]?.id ??
                null)
              : currentWorkspace.activeTabId,
          tabs: currentWorkspace.tabs.filter((currentTab) => currentTab.id !== tab.id)
        }
      })
    } finally {
      closingTabsRef.current.delete(tab.id)
    }
  }

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div className="terminal-panel__toolbar">
        <SegmentedControl
          aria-label="Terminal tabs"
          className="terminal-panel__tabs"
          options={workspace.tabs.map((tab) => ({
            value: tab.id,
            label: tab.label,
            ariaLabel: tab.label,
            title: tab.label,
            icon: <TerminalIcon aria-hidden="true" />,
            actionAriaLabel: `Close ${tab.label}`,
            actionTitle: `Close ${tab.label}`,
            actionIcon: <X aria-hidden="true" />,
            actionCallback: () => handleCloseTab(tab)
          }))}
          value={workspace.activeTabId ?? ''}
          onChange={focusTab}
        />
        <Button
          theme="transparent"
          size="small"
          aria-label="New terminal"
          title="New terminal"
          callback={handleAddTab}
          icon={<Plus aria-hidden="true" />}
        />
      </div>
      <div className="terminal-panel__workspace">
        {workspace.tabs.length === 0 && (
          <div className="terminal-panel__empty">
            <TerminalIcon aria-hidden="true" />
            <p>No terminal tabs open.</p>
            <Button
              theme="secondary"
              size="small"
              label="New terminal"
              callback={handleAddTab}
              icon={<Plus aria-hidden="true" />}
            />
          </div>
        )}
        {workspace.tabs.map((tab) =>
          tab.kind === 'agent' ? (
            <AgentTerminalSession
              chatId={tab.chatId}
              command={tab.command}
              initialOutput={tab.initialOutput}
              initialStatus={tab.initialStatus}
              itemId={tab.itemId}
              key={tab.id}
              label={tab.label}
              processId={tab.processId}
              providerId={tab.providerId}
              snapshot={
                agentTerminalSnapshots.find(
                  (snapshot) =>
                    snapshot.providerId === tab.providerId &&
                    snapshot.chatId === tab.chatId &&
                    snapshot.processId === tab.processId
                ) ?? null
              }
              tabId={tab.id}
              turnId={tab.turnId}
              visible={tab.id === workspace.activeTabId}
              onStateChange={handleTabStateChange}
            />
          ) : (
            <TerminalSession
              closeOnCommandFinish={tab.closeOnCommandFinish}
              container={tab.container}
              cwd={tab.cwd}
              initialCommand={tab.initialCommand}
              key={tab.id}
              label={tab.label}
              tabId={tab.id}
              visible={tab.id === workspace.activeTabId}
              onCommandFinish={handleCommandFinish}
              onStateChange={handleTabStateChange}
            />
          )
        )}
      </div>
    </section>
  )
}
