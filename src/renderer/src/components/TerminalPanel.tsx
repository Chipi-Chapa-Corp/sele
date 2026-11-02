import { useFeedbackMotion } from '../motion/useFeedbackMotion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ITheme, Terminal as XtermTerminal } from '@xterm/xterm'
import { Plus, Terminal as TerminalIcon, X } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import { appFontSettingsChangedEvent, getCodeFontAppearance } from '../fontAppearance'
import { terminalApi } from '../terminalApi'
import { Button } from './Button'
import { SegmentedControl } from './SegmentedControl'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'
import { chatTerminalActivity } from '../chatTerminalActivity'
import { createPanelTerminalTask } from '../panelTerminalTask'
import { getAgentTerminalChat, getAgentTerminalTabLabel } from '../agentTerminalChats'
import { getContainerTargetKey } from '../containerSelection'

export type TerminalCommandLaunchRequest = {
  chatKey?: string | null
  id: string
  command: string
  container: AppContainerTarget | null
  cwd: string | null
  projectCwd: string | null
  workspaceKey: string
  label: string | null
  focus: boolean
  closeOnFinish: boolean
}

type TerminalPanelProps = {
  chatKey?: string | null
  active: boolean
  container: AppContainerTarget | null
  cwd: string | null
  projectCwd: string | null
  workspaceKey: string
  commandLaunchRequest?: TerminalCommandLaunchRequest | null
}

type TerminalState = 'starting' | 'running' | 'exited' | 'error'

type TerminalOutputCache = { value: string }

type TerminalTab = {
  outputCache: TerminalOutputCache
  agentSessionId?: string
  agentStopScope?: 'process' | 'turn'
  agentInteractive?: boolean
  focusOnShow?: boolean
  chatKey?: string | null
  id: string
  label: string
  container: AppContainerTarget | null
  cwd: string | null
  initialCommand: string | null
  closeOnCommandFinish: boolean
}

type TerminalSessionProps = {
  outputCache: TerminalOutputCache
  agentSessionId?: string
  agentInteractive?: boolean
  onInterrupt: () => void
  focusOnShow: boolean
  chatKey: string | null
  initialChatKey: string | null
  closeOnCommandFinish: boolean
  container: AppContainerTarget | null
  cwd: string | null
  initialCommand: string | null
  label: string
  tabId: string
  visible: boolean
  onCommandFinish: (tabId: string) => void
  onInput: (tabId: string) => void
  onStateChange: (
    tabId: string,
    state: TerminalState,
    sessionId: string | null,
    agentAttached: boolean
  ) => void
}

type TerminalTabRuntime = {
  agentAttached: boolean
  sessionId: string | null
  state: TerminalState
}

type TerminalWorkspace = {
  activeTabId: string | null
  tabs: TerminalTab[]
}

const outputPauseThreshold = 512 * 1024
const outputResumeThreshold = 64 * 1024

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

const getTerminalTheme = (host: HTMLElement): ITheme => {
  const theme =
    document.documentElement.dataset.colorScheme === 'dark' ? darkTerminalTheme : lightTerminalTheme
  const background = getComputedStyle(host).getPropertyValue('--control-surface').trim()

  return {
    ...theme,
    background: background || theme.background,
    cursorAccent: background || theme.cursorAccent
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    : 'Unable to start the terminal.'

const isExpectedWebglUnavailableError = (error: unknown): boolean =>
  error instanceof Error &&
  /webgl(?:2)? (?:is )?not supported|unable to create (?:a )?webgl|webgl context (?:creation )?failed/i.test(
    error.message
  )

const createTerminalTab = (
  number: number,
  cwd: string | null,
  container: AppContainerTarget | null
): TerminalTab => ({
  outputCache: { value: '' },
  id: crypto.randomUUID(),
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

const createCommandTerminalTab = (request: TerminalCommandLaunchRequest): TerminalTab => ({
  outputCache: { value: '' },
  chatKey: request.chatKey,
  id: crypto.randomUUID(),
  label: request.label?.trim() || getCommandTabLabel(request.command),
  container: request.container,
  cwd: request.cwd,
  initialCommand: request.command,
  closeOnCommandFinish: request.closeOnFinish
})

export const TerminalSession: React.FC<TerminalSessionProps> = ({
  agentSessionId,
  agentInteractive,
  outputCache,
  onInterrupt,
  focusOnShow,
  chatKey,
  initialChatKey,
  closeOnCommandFinish,
  container,
  cwd,
  initialCommand,
  label,
  tabId,
  visible,
  onCommandFinish,
  onInput,
  onStateChange
}) => {
  const chatKeyRef = useRef(chatKey)
  chatKeyRef.current = chatKey
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const visibleRef = useRef(visible)
  const focusOnShowRef = useRef(focusOnShow)
  const interruptRef = useRef(onInterrupt)
  interruptRef.current = onInterrupt
  const nativeSessionId = agentSessionId
  focusOnShowRef.current = focusOnShow

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    if (!visible || !focusOnShow) return

    const frame = requestAnimationFrame(() => {
      fitRef.current?.()
      terminalRef.current?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [visible, focusOnShow])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const sessionId = crypto.randomUUID()
    let active = true
    let sessionCreated = false
    let sessionExited = false
    let receivedOutput = false
    let outputFrame: number | null = null
    let resizeFrame: number | null = null
    let resizeObserver: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null
    let removeFontSettingsListener: (() => void) | null = null
    let removeDataListener: (() => void) | null = null
    let removeExitListener: (() => void) | null = null
    let terminal: XtermTerminal | null = null
    let outputChunks: string[] = []
    let pendingOutputCharacters = 0
    let ptyPaused = false
    let lastColumns = 0
    let lastRows = 0
    let taskPoll: number | null = null
    let checkingTask = false
    const task = createPanelTerminalTask({
      initialChatKey,
      currentChatKey: () => chatKeyRef.current,
      readStatus: () => terminalApi.getProcessStatus(sessionId),
      report: (key, running, completed) =>
        chatTerminalActivity.report(
          key,
          `panel:${sessionId}`,
          running ? [sessionId] : [],
          completed
        )
    })

    const updateState = (nextState: TerminalState): void => {
      if (!active) return
      onStateChange(tabId, nextState, sessionId, Boolean(nativeSessionId))
    }

    updateState('starting')
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

    const restoreOutput = (): void => {
      if (!receivedOutput && outputCache.value) {
        terminal?.write(outputCache.value)
        receivedOutput = true
      }
    }
    const unavailable = (): void => {
      if (!active) return
      restoreOutput()
      queueOutput(
        '\r\n\u001b[90m[Process is no longer connected. Previous output is kept here.]\u001b[0m\r\n'
      )
      sessionExited = true
      if (terminal) terminal.options.disableStdin = true
      updateState('exited')
      window.requestAnimationFrame(() => onCommandFinish(tabId))
    }

    const start = async (): Promise<void> => {
      try {
        const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-webgl')
        ])
        if (!active) return
        const codeFont = getCodeFontAppearance()

        terminal = new Terminal({
          allowTransparency: false,
          convertEol: Boolean(nativeSessionId),
          cursorBlink: true,
          cursorStyle: 'block',
          disableStdin: true,
          drawBoldTextInBrightColors: true,
          fontFamily: codeFont.family,
          fontSize: codeFont.size,
          letterSpacing: 0,
          lineHeight: 1.15,
          macOptionIsMeta: true,
          minimumContrastRatio: 1,
          rightClickSelectsWord: true,
          scrollback: 5_000,
          scrollOnUserInput: true,
          theme: getTerminalTheme(host)
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
        } catch (error) {
          if (!isExpectedWebglUnavailableError(error)) {
            console.error('[caught:TerminalPanel:start]', error)
          }
          // xterm keeps using its default DOM renderer when WebGL is unavailable.
        }

        themeObserver = new MutationObserver(() => {
          if (terminal) terminal.options.theme = getTerminalTheme(host)
        })
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-color-scheme']
        })

        const handleFontSettingsChanged = (): void => {
          if (!terminal) return
          const font = getCodeFontAppearance()
          terminal.options.fontFamily = font.family
          terminal.options.fontSize = font.size
          window.requestAnimationFrame(() => fitRef.current?.())
        }
        window.addEventListener(appFontSettingsChangedEvent, handleFontSettingsChanged)
        removeFontSettingsListener = () =>
          window.removeEventListener(appFontSettingsChangedEvent, handleFontSettingsChanged)

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

          if (
            nativeSessionId &&
            event.ctrlKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === 'c'
          ) {
            interruptRef.current()
            return false
          }

          if (pastePressed) {
            // Let the browser paste event feed xterm. Reading and pasting here as well
            // causes the same clipboard contents to be submitted twice.
            return false
          }

          return true
        })

        removeDataListener = terminalApi.onData((event) => {
          if (event.sessionId === sessionId) {
            if (!receivedOutput) {
              receivedOutput = true
              outputCache.value = ''
            }
            outputCache.value = (outputCache.value + event.data).slice(-512 * 1024)
            if (!nativeSessionId) task.output(event.data)
            queueOutput(event.data)
          }
        })
        removeExitListener = terminalApi.onExit((event) => {
          if (event.sessionId !== sessionId) return

          sessionExited = true
          task.finish()
          sessionCreated = false
          queueOutput(
            `\r\n\u001b[90m[process exited with code ${event.exitCode}${
              event.signal == null ? '' : `, signal ${event.signal}`
            }]\u001b[0m\r\n`
          )
          updateState('exited')
          if (nativeSessionId) void terminalApi.closeSession(sessionId)
          if (closeOnCommandFinish || nativeSessionId) {
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

        if (initialCommand?.trim()) {
          terminal.writeln(`$ ${initialCommand.trim().replace(/\r?\n/g, '\r\n')}`)
        }

        if (initialCommand?.trim() && !nativeSessionId) task.start()
        if (nativeSessionId) {
          const result = await terminalApi.attachAgentSession(sessionId, nativeSessionId)
          if (result?.status === 'unavailable') {
            unavailable()
            return
          }
        } else
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

        if (sessionExited) {
          if (nativeSessionId) await terminalApi.closeSession(sessionId)
          return
        }

        sessionCreated = true
        if (!nativeSessionId)
          taskPoll = window.setInterval(() => {
            if (checkingTask) return
            checkingTask = true
            void task
              .check()
              .catch((error) => {
                console.error('Unable to read terminal task status.', error)
              })
              .finally(() => {
                checkingTask = false
              })
          }, 500)
        terminal.options.disableStdin = Boolean(nativeSessionId && !agentInteractive)
        if (ptyPaused) terminalApi.setPaused(sessionId, true)
        updateState('running')

        terminal.onData((data) => {
          if (sessionCreated) {
            onInput(tabId)
            if (!nativeSessionId) task.input(data)
            terminalApi.write(sessionId, data)
          }
        })
        if (visibleRef.current && focusOnShowRef.current) terminal.focus()
      } catch (startError) {
        task.dispose()
        if (!active) return
        const message = getErrorMessage(startError)
        if (nativeSessionId && message === 'This agent process is no longer available.') {
          unavailable()
          return
        }
        console.error('[caught:TerminalPanel:start]', startError)
        restoreOutput()
        updateState('error')
        terminal?.writeln(`\r\n\u001b[31m${message}\u001b[0m`)
      }
    }

    void start()

    return () => {
      if (taskPoll !== null) window.clearInterval(taskPoll)
      task.dispose()
      active = false
      if (outputFrame != null) cancelAnimationFrame(outputFrame)
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      removeFontSettingsListener?.()
      removeDataListener?.()
      removeExitListener?.()
      fitRef.current = null
      terminalRef.current = null
      terminal?.dispose()
      if (sessionCreated) void terminalApi.closeSession(sessionId)
    }
  }, [
    nativeSessionId,
    agentInteractive,
    outputCache,
    closeOnCommandFinish,
    container,
    cwd,
    initialCommand,
    initialChatKey,
    onCommandFinish,
    onInput,
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
      <div className="terminal-panel__surface" onPointerDown={() => terminalRef.current?.focus()}>
        <div className="terminal-panel__host" ref={hostRef} />
      </div>
    </div>
  )
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  chatKey = null,
  active,
  container,
  cwd,
  projectCwd,
  workspaceKey,
  commandLaunchRequest = null
}) => {
  const nextTabNumberByWorkspaceRef = useRef(new Map<string, number>([[workspaceKey, 2]]))
  const closingTabsRef = useRef(new Set<string>())
  const usedTabIdsRef = useRef(new Set<string>())
  const handledCommandLaunchRequestIdsRef = useRef(new Set<string>())
  const tabRuntimesRef = useRef(new Map<string, TerminalTabRuntime>())
  const viewedAgentTabsRef = useRef(new Set<string>())
  const handledAgentSessionsRef = useRef(new Set<string>())
  const [workspaces, setWorkspaces] = useState(() => {
    if (!active) return new Map<string, TerminalWorkspace>()
    const initialLocalTab = createTerminalTab(1, projectCwd ?? cwd, container)
    initialLocalTab.chatKey = chatKey
    return new Map<string, TerminalWorkspace>([
      [workspaceKey, { activeTabId: initialLocalTab.id, tabs: [initialLocalTab] }]
    ])
  })
  const workspace = workspaces.get(workspaceKey) ?? null

  useLayoutEffect(() => {
    if (active && workspace?.activeTabId) viewedAgentTabsRef.current.add(workspace.activeTabId)
  }, [active, workspace?.activeTabId])

  useEffect(() => {
    let disposed = false
    let polling = false
    const poll = async () => {
      if (polling || !terminalApi.listAgentSessions) return
      polling = true
      try {
        const sessions = await terminalApi.listAgentSessions()
        if (disposed) return
        const pending = sessions.filter(
          (session) => !handledAgentSessionsRef.current.has(session.id)
        )
        for (const session of pending) handledAgentSessionsRef.current.add(session.id)
        setWorkspaces((current) => {
          const next = new Map(current)
          let changed = false
          for (const [key, workspace] of current) {
            const tabs = workspace.tabs.map((tab) => {
              const source = sessions.find((source) => source.id === tab.agentSessionId)
              if (!source || tab.agentStopScope === source.stopScope) return tab
              changed = true
              return { ...tab, agentStopScope: source.stopScope }
            })
            if (tabs.some((tab, index) => tab !== workspace.tabs[index]))
              next.set(key, { ...workspace, tabs })
          }
          for (const source of pending) {
            if (source.status === 'exited') {
              void terminalApi.dismissAgentSession(source.id)
              continue
            }
            const key = `${source.providerId}:${source.chatId}`
            const chat = getAgentTerminalChat(key)
            const target = `${getContainerTargetKey(source.container)}\0${chat?.projectCwd ?? chat?.cwd ?? source.cwd ?? ''}`
            const previous = next.get(target) ?? { activeTabId: null, tabs: [] }
            const tab: TerminalTab = {
              id: crypto.randomUUID(),
              outputCache: { value: '' },
              agentSessionId: source.id,
              chatKey: key,
              agentStopScope: source.stopScope,
              agentInteractive: source.interactive,
              label: getAgentTerminalTabLabel(chat?.title ?? source.chatTitle, source.index),
              container: source.container,
              cwd: source.cwd,
              initialCommand: source.command,
              closeOnCommandFinish: true,
              focusOnShow: false
            }
            next.set(target, {
              activeTabId: previous.activeTabId ?? tab.id,
              tabs: [...previous.tabs, tab]
            })
            changed = true
          }
          return changed ? next : current
        })
      } catch (error) {
        if (!disposed) console.error('Unable to list agent terminals.', error)
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const handleTabInput = useCallback((tabId: string): void => {
    usedTabIdsRef.current.add(tabId)
  }, [])

  const handleTabStateChange = useCallback(
    (
      tabId: string,
      state: TerminalState,
      sessionId: string | null,
      agentAttached: boolean
    ): void => {
      tabRuntimesRef.current.set(tabId, { sessionId, state, agentAttached })
    },
    []
  )

  useEffect(() => {
    if (!active) return

    setWorkspaces((currentWorkspaces) => {
      if (currentWorkspaces.has(workspaceKey)) return currentWorkspaces

      const initialLocalTab = createTerminalTab(1, projectCwd ?? cwd, container)
      const nextWorkspaces = new Map(currentWorkspaces)
      nextWorkspaces.set(workspaceKey, {
        activeTabId: initialLocalTab.id,
        tabs: [initialLocalTab]
      })
      nextTabNumberByWorkspaceRef.current.set(workspaceKey, 2)
      return nextWorkspaces
    })
  }, [active, container, cwd, projectCwd, workspaceKey])

  useEffect(() => {
    if (
      !commandLaunchRequest ||
      handledCommandLaunchRequestIdsRef.current.has(commandLaunchRequest.id)
    ) {
      return
    }

    handledCommandLaunchRequestIdsRef.current.add(commandLaunchRequest.id)
    const tab = createCommandTerminalTab(commandLaunchRequest)
    setWorkspaces((currentWorkspaces) => {
      const currentWorkspace = currentWorkspaces.get(commandLaunchRequest.workspaceKey)
      const initialLocalTab = currentWorkspace
        ? null
        : createTerminalTab(
            1,
            commandLaunchRequest.projectCwd ?? commandLaunchRequest.cwd,
            commandLaunchRequest.container
          )
      const targetWorkspace =
        currentWorkspace ??
        ({
          activeTabId: initialLocalTab?.id ?? null,
          tabs: initialLocalTab ? [initialLocalTab] : []
        } satisfies TerminalWorkspace)
      const nextWorkspaces = new Map(currentWorkspaces)

      if (!currentWorkspace) {
        nextTabNumberByWorkspaceRef.current.set(commandLaunchRequest.workspaceKey, 2)
      }
      const isEmptyTab = (candidate: TerminalTab): boolean =>
        !candidate.agentSessionId &&
        !candidate.initialCommand &&
        !candidate.closeOnCommandFinish &&
        !usedTabIdsRef.current.has(candidate.id) &&
        !closingTabsRef.current.has(candidate.id)
      // Auto-closing actions get a dedicated tab so the user's empty shell stays open.
      const emptyTab = commandLaunchRequest.closeOnFinish
        ? null
        : (targetWorkspace.tabs.find(
            (candidate) => candidate.id === targetWorkspace.activeTabId && isEmptyTab(candidate)
          ) ?? targetWorkspace.tabs.find(isEmptyTab))
      const commandTab = emptyTab ? { ...tab, id: emptyTab.id } : tab
      nextWorkspaces.set(commandLaunchRequest.workspaceKey, {
        activeTabId:
          commandLaunchRequest.focus || !targetWorkspace.activeTabId
            ? commandTab.id
            : targetWorkspace.activeTabId,
        tabs: emptyTab
          ? targetWorkspace.tabs.map((candidate) =>
              candidate.id === emptyTab.id ? commandTab : candidate
            )
          : [...targetWorkspace.tabs, commandTab]
      })
      return nextWorkspaces
    })
  }, [commandLaunchRequest])

  const handleAddTab = (): void => {
    const nextTabNumber = nextTabNumberByWorkspaceRef.current.get(workspaceKey) ?? 1
    const tab = createTerminalTab(nextTabNumber, cwd ?? projectCwd, container)
    tab.chatKey = chatKey
    nextTabNumberByWorkspaceRef.current.set(workspaceKey, nextTabNumber + 1)
    setWorkspaces((currentWorkspaces) => {
      const currentWorkspace = currentWorkspaces.get(workspaceKey) ?? {
        activeTabId: null,
        tabs: []
      }
      const nextWorkspaces = new Map(currentWorkspaces)
      nextWorkspaces.set(workspaceKey, {
        activeTabId: tab.id,
        tabs: [...currentWorkspace.tabs, tab]
      })
      return nextWorkspaces
    })
  }

  const focusTab = (tabId: string): void => {
    viewedAgentTabsRef.current.add(tabId)
    setWorkspaces((currentWorkspaces) => {
      const currentWorkspace = currentWorkspaces.get(workspaceKey)
      if (!currentWorkspace) return currentWorkspaces

      const nextWorkspaces = new Map(currentWorkspaces)
      nextWorkspaces.set(workspaceKey, {
        ...currentWorkspace,
        activeTabId: tabId,
        tabs: currentWorkspace.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, focusOnShow: true } : tab
        )
      })
      return nextWorkspaces
    })
  }

  const handleCommandFinish = useCallback((tabId: string): void => {
    usedTabIdsRef.current.delete(tabId)
    tabRuntimesRef.current.delete(tabId)
    setWorkspaces((currentWorkspaces) => {
      for (const [currentWorkspaceKey, currentWorkspace] of currentWorkspaces) {
        const closingIndex = currentWorkspace.tabs.findIndex(
          (currentTab) => currentTab.id === tabId
        )
        if (closingIndex < 0) continue
        const finished = currentWorkspace.tabs[closingIndex]
        if (finished.agentSessionId) {
          if (viewedAgentTabsRef.current.has(tabId)) return currentWorkspaces
          void terminalApi.dismissAgentSession(finished.agentSessionId)
        }

        const nextWorkspaces = new Map(currentWorkspaces)
        nextWorkspaces.set(currentWorkspaceKey, {
          activeTabId:
            currentWorkspace.activeTabId === tabId
              ? (currentWorkspace.tabs[closingIndex + 1]?.id ??
                currentWorkspace.tabs[closingIndex - 1]?.id ??
                null)
              : currentWorkspace.activeTabId,
          tabs: currentWorkspace.tabs.filter((currentTab) => currentTab.id !== tabId)
        })
        return nextWorkspaces
      }

      return currentWorkspaces
    })
  }, [])

  const handleCloseTab = async (closingWorkspaceKey: string, tab: TerminalTab): Promise<void> => {
    if (closingTabsRef.current.has(tab.id)) return
    closingTabsRef.current.add(tab.id)

    try {
      const runtime = tabRuntimesRef.current.get(tab.id)
      const nativeStarting =
        tab.agentSessionId &&
        runtime?.agentAttached !== false &&
        (!runtime || runtime.state === 'starting')
      if ((runtime?.state === 'running' && runtime.sessionId) || nativeStarting) {
        const processStatus = nativeStarting
          ? { hasActiveProcess: true, processName: null }
          : await terminalApi.getProcessStatus(runtime!.sessionId!).catch((error) => {
              console.error('[caught:TerminalPanel:handleCloseTab]', error)
              return null
            })

        if (
          processStatus?.hasActiveProcess &&
          !window.confirm(
            processStatus.processName
              ? `${processStatus.processName} is still running in ${tab.label}. Close it anyway?`
              : runtime?.agentAttached !== false && tab.agentStopScope === 'turn'
                ? `This command is controlled by the agent's current turn. Stop that turn and close ${tab.label}?`
                : `A process is still running in ${tab.label}. Close it anyway?`
          )
        ) {
          return
        }
      }

      if (tab.agentSessionId) {
        await terminalApi.stopAgentSession(tab.agentSessionId)
        await terminalApi.dismissAgentSession(tab.agentSessionId)
      }
      tabRuntimesRef.current.delete(tab.id)
      usedTabIdsRef.current.delete(tab.id)
      setWorkspaces((currentWorkspaces) => {
        const currentWorkspace = currentWorkspaces.get(closingWorkspaceKey)
        if (!currentWorkspace) return currentWorkspaces
        const closingIndex = currentWorkspace.tabs.findIndex(
          (currentTab) => currentTab.id === tab.id
        )
        if (closingIndex < 0) return currentWorkspaces

        const nextWorkspaces = new Map(currentWorkspaces)
        nextWorkspaces.set(closingWorkspaceKey, {
          activeTabId:
            currentWorkspace.activeTabId === tab.id
              ? (currentWorkspace.tabs[closingIndex + 1]?.id ??
                currentWorkspace.tabs[closingIndex - 1]?.id ??
                null)
              : currentWorkspace.activeTabId,
          tabs: currentWorkspace.tabs.filter((currentTab) => currentTab.id !== tab.id)
        })
        return nextWorkspaces
      })
    } catch (error) {
      console.error('Unable to close terminal.', error)
      window.alert(getErrorMessage(error))
    } finally {
      closingTabsRef.current.delete(tab.id)
    }
  }

  const motionPanelRef = useRef<HTMLElement>(null)
  useFeedbackMotion(motionPanelRef, workspace?.activeTabId, 'panel')

  return (
    <section ref={motionPanelRef} className="terminal-panel" aria-label="Terminal">
      <div className="terminal-panel__toolbar">
        <SegmentedControl
          aria-label="Terminal tabs"
          className="terminal-panel__tabs"
          options={(workspace?.tabs ?? []).map((tab) => ({
            value: tab.id,
            label: tab.label,
            ariaLabel: tab.label,
            title: tab.label,
            icon: <TerminalIcon aria-hidden="true" />,
            actionAriaLabel: `Close ${tab.label}`,
            actionTitle: `Close ${tab.label}`,
            actionIcon: <X aria-hidden="true" />,
            actionCallback: () => handleCloseTab(workspaceKey, tab)
          }))}
          value={workspace?.activeTabId ?? ''}
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
        {workspace?.tabs.length === 0 && (
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
        {Array.from(workspaces, ([currentWorkspaceKey, currentWorkspace]) =>
          currentWorkspace.tabs.map((tab) => (
            <TerminalSession
              outputCache={tab.outputCache}
              agentSessionId={tab.agentSessionId}
              agentInteractive={tab.agentInteractive}
              onInterrupt={() => {
                if (!tab.agentSessionId) return
                if (
                  tab.agentStopScope === 'turn' &&
                  !window.confirm(
                    'This command is controlled by the agent’s current turn. Stop that turn?'
                  )
                )
                  return
                void terminalApi.stopAgentSession(tab.agentSessionId).catch((error) => {
                  console.error('Unable to stop agent process.', error)
                  window.alert(getErrorMessage(error))
                })
              }}
              focusOnShow={tab.focusOnShow ?? true}
              chatKey={chatKey}
              initialChatKey={tab.chatKey ?? null}
              closeOnCommandFinish={tab.closeOnCommandFinish}
              container={tab.container}
              cwd={tab.cwd}
              initialCommand={tab.initialCommand}
              key={tab.id}
              label={tab.label}
              tabId={tab.id}
              visible={
                active &&
                currentWorkspaceKey === workspaceKey &&
                tab.id === currentWorkspace.activeTabId
              }
              onCommandFinish={handleCommandFinish}
              onInput={handleTabInput}
              onStateChange={handleTabStateChange}
            />
          ))
        )}
      </div>
    </section>
  )
}
