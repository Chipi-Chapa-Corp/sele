import { registerBrowserUseSession, removeBrowserUseSessions } from './CodexBrowserSessions'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AppContainerTarget } from '../../../shared/app'
import { getHostCommand, isRunningInFlatpak } from '../../hostProcess'
import { getCodexExecutable, getCodexExecutableError } from './CodexExecutable'
import { getCodexAccountViewCommand } from './CodexAccountView'
import { ensureCodexAccountView } from './CodexAccounts'
import { CodexDynamicTools } from './CodexDynamicTools'
import { registerCodexDesktopTools } from './CodexDesktopTools'

type RpcError = {
  code: number
  message: string
  data?: unknown
}

type RpcResponse = {
  id: number
  result?: unknown
  error?: RpcError
}

export type RpcNotification = {
  method: string
  params?: unknown
}

export type RpcRequest = {
  id: number
  method: string
  params?: unknown
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  cleanup?: () => void
}

const requestTimeoutMs = 30_000
const threadListRequestTimeoutMs = 180_000
const codexResourceMemoryHigh = '2G'

type AppServerCommand = {
  command: string
  args: string[]
}

const getAppServerCommand = (
  binary: string,
  options: { container?: AppContainerTarget | null; accountId?: string } = {}
): AppServerCommand => {
  // Account handoffs must release the writer as soon as we unsubscribe, rather
  // than retaining it for Codex's default inactive-thread grace period.
  const appServerArgs = ['app-server', '-c', 'thread_unload_delay_secs=0', '--listen', 'stdio://']
  const accountViewCommand = getCodexAccountViewCommand(
    binary,
    appServerArgs,
    process.platform === 'linux' || options.container?.kind === 'container',
    options.accountId
  )
  const canUseSystemd =
    process.platform === 'linux' &&
    !isRunningInFlatpak() &&
    options.container?.kind !== 'container' &&
    Boolean(process.env.DBUS_SESSION_BUS_ADDRESS) &&
    process.env.SELE_DISABLE_CODEX_RESOURCE_ISOLATION !== '1'

  if (!canUseSystemd) {
    return {
      command: accountViewCommand.file,
      args: accountViewCommand.args
    }
  }

  const resourceUnitName = `sele-codex-${process.pid}-${Date.now()}`
  return {
    command: 'systemd-run',
    args: [
      '--user',
      '--pipe',
      '--wait',
      '--collect',
      '--quiet',
      `--unit=${resourceUnitName}`,
      '--property=CPUWeight=25',
      '--property=IOWeight=25',
      `--property=MemoryHigh=${codexResourceMemoryHigh}`,
      '--property=OOMScoreAdjust=500',
      accountViewCommand.file,
      ...accountViewCommand.args
    ]
  }
}

export class CodexAppServerClient {
  constructor(
    private readonly container: AppContainerTarget | null = null,
    private readonly accountId?: string
  ) {
    if (!container) this.desktopTools = registerCodexDesktopTools(this.dynamicTools)
  }
  private desktopTools: ReturnType<typeof registerCodexDesktopTools> | null = null

  private process: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<void> | null = null
  private pendingRequests = new Map<number, PendingRequest>()
  private notificationListeners = new Set<(notification: RpcNotification) => void>()
  private serverRequestListeners = new Set<(request: RpcRequest) => boolean | void>()
  private stoppedListeners = new Set<(error: Error) => void>()
  private nextRequestId = 1
  private stderr = ''
  private browserSessionCwds = new Map<string, string>()
  private ownedThreadIds = new Set<string>()
  readonly dynamicTools = new CodexDynamicTools()
  private requestFailureListeners = new Set<
    (method: string, params: unknown, error: unknown) => void
  >()
  onRequestFailed = (
    listener: (method: string, params: unknown, error: unknown) => void
  ): (() => void) => {
    this.requestFailureListeners.add(listener)
    return () => this.requestFailureListeners.delete(listener)
  }

  get connectionIdentity(): object | null {
    return this.process
  }

  ownsThread = (threadId: string): boolean => this.ownedThreadIds.has(threadId)

  releaseThread = async (threadId: string): Promise<void> => {
    let closed!: () => void
    let failed!: (error: Error) => void
    const completion = new Promise<void>((resolve, reject) => {
      closed = resolve
      failed = reject
    })
    // Subscribe before the request: thread/closed can precede its response.
    const unsubscribe = this.onNotification((notification) => {
      if (
        notification.method === 'thread/closed' &&
        (notification.params as { threadId?: string } | undefined)?.threadId === threadId
      )
        closed()
    })
    const unsubscribeStopped = this.onStopped(failed)
    const timeout = setTimeout(
      () =>
        failed(
          new Error('Codex is still releasing this chat. Please try switching accounts again.')
        ),
      requestTimeoutMs
    )
    try {
      await Promise.all([
        completion,
        this.request<{ status: string }>('thread/unsubscribe', { threadId }).then((result) => {
          if (result.status === 'notLoaded') closed()
        })
      ])
      this.ownedThreadIds.delete(threadId)
      this.browserSessionCwds.delete(threadId)
    } finally {
      clearTimeout(timeout)
      unsubscribe()
      unsubscribeStopped()
    }
  }

  request = async <Result>(
    method: string,
    params: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<Result> => {
    await this.start()
    const input = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    if (
      (method === 'thread/start' || method === 'thread/resume') &&
      input.ephemeral !== true &&
      input.sandbox !== 'read-only' &&
      input.dynamicTools === undefined &&
      this.dynamicTools.specs.length > 0
    ) {
      params = { ...input, dynamicTools: this.dynamicTools.specs }
    }
    if (method === 'turn/start' && typeof input.threadId === 'string') {
      const sandbox = input.sandboxPolicy as { type?: string } | undefined
      if (sandbox?.type) this.dynamicTools.setReadOnly(input.threadId, sandbox.type === 'readOnly')
      registerBrowserUseSession(
        this,
        input.threadId,
        this.browserSessionCwds.get(input.threadId) ?? null,
        this.container
      )
    }
    let result: Result
    try {
      result = await this.sendRequest<Result>(method, params, options)
    } catch (error) {
      for (const listener of this.requestFailureListeners) {
        try {
          listener(method, params, error)
        } catch (notificationError) {
          console.error('Unable to report Codex request failure.', notificationError)
        }
      }
      throw error
    }
    if (method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') {
      const thread = (result as { thread?: { id?: string; cwd?: string } })?.thread
      if (typeof thread?.id === 'string') {
        this.ownedThreadIds.add(thread.id)
        if (method === 'thread/fork' && typeof input.threadId === 'string')
          this.dynamicTools.inherit(thread.id, input.threadId)
        else {
          this.dynamicTools.bind(thread.id, (params as Record<string, unknown>)?.dynamicTools)
          this.dynamicTools.setReadOnly(thread.id, input.sandbox === 'read-only')
        }
        const cwd = thread.cwd ?? (typeof input.cwd === 'string' ? input.cwd : '')
        this.browserSessionCwds.set(thread.id, cwd)
        registerBrowserUseSession(this, thread.id, cwd, this.container)
      }
    }
    if (
      method === 'thread/unsubscribe' &&
      typeof input.threadId === 'string' &&
      (result as { status?: string })?.status === 'notLoaded'
    ) {
      this.ownedThreadIds.delete(input.threadId)
      this.browserSessionCwds.delete(input.threadId)
    }
    return result
  }

  onNotification = (listener: (notification: RpcNotification) => void): (() => void) => {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onServerRequest = (listener: (request: RpcRequest) => boolean | void): (() => void) => {
    this.serverRequestListeners.add(listener)
    return () => this.serverRequestListeners.delete(listener)
  }

  onStopped = (listener: (error: Error) => void): (() => void) => {
    this.stoppedListeners.add(listener)
    return () => this.stoppedListeners.delete(listener)
  }

  resolveServerRequest = (id: number, result: unknown): void => {
    this.write({ id, result })
  }

  rejectServerRequest = (id: number, message: string, code = -32603): void => {
    this.write({ id, error: { code, message } })
  }

  dispose = (): void => {
    this.desktopTools?.close()
    this.dynamicTools.clear()
    this.ownedThreadIds.clear()
    removeBrowserUseSessions(this)
    this.process?.kill()
    this.process = null
    this.startPromise = null
    this.rejectPending(new Error('Codex app-server stopped'))
  }

  disposeAndWait = async (): Promise<void> => {
    const child = this.process
    if (!child || child.exitCode !== null) {
      this.dispose()
      return
    }

    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    this.dispose()
    await closed
  }

  private start = async (): Promise<void> => {
    if (!this.startPromise) {
      const startPromise = this.initialize().catch((error: unknown) => {
        if (this.startPromise === startPromise) this.startPromise = null
        throw error
      })
      this.startPromise = startPromise
    }

    return this.startPromise
  }

  private initialize = async (): Promise<void> => {
    if (this.accountId && this.accountId !== 'default') await ensureCodexAccountView(this.container)
    const appServerCommand = getAppServerCommand(
      this.container?.kind === 'container' ? 'codex' : getCodexExecutable(),
      { container: this.container, accountId: this.accountId }
    )
    const hostCommand = await getHostCommand(appServerCommand.command, appServerCommand.args, {
      container: this.container,
      env: process.env
    }).catch((error: unknown) => {
      throw getCodexExecutableError(error)
    })
    const child = spawn(hostCommand.file, hostCommand.args, {
      env: hostCommand.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.process = child
    this.stderr = ''

    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.process === child) this.handleLine(line)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (this.process !== child) return
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-2_000)
    })

    const handleError = (error: Error): void => {
      if (this.process === child) this.handleProcessEnd(error)
    }
    // Pipe failures are emitted asynchronously by stdin, outside sendRequest's
    // try/catch. Keep this listener even after disposal to absorb late EPIPEs.
    child.stdin.on('error', handleError)
    child.on('error', handleError)

    child.on('close', (code) => {
      const detail = this.stderr.trim()
      const message = detail || `Codex app-server exited with code ${code ?? 'unknown'}`
      handleError(new Error(message))
    })

    await this.sendRequest('initialize', {
      clientInfo: { name: 'sele', title: 'Sele', version: '1.0.0' },
      capabilities: {
        experimentalApi: true,
        mcpServerOpenaiFormElicitation: true,
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
        requestAttestation: false
      }
    })

    this.sendNotification('initialized')
  }

  private sendRequest = <Result>(
    method: string,
    params: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<Result> => {
    if (options?.signal?.aborted) return Promise.reject(new Error('Request canceled.'))
    const id = this.nextRequestId++

    return new Promise<Result>((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pendingRequests.get(id)
        if (!pending) return
        clearTimeout(pending.timeout)
        pending.cleanup?.()
        this.pendingRequests.delete(id)
        reject(new Error('Request canceled.'))
        if (method === 'userVerification/verify')
          void this.sendRequest('userVerification/cancel', { requestId: id }).catch((error) =>
            console.error('Unable to cancel device verification.', error)
          )
      }
      const timeout = setTimeout(
        () => {
          this.pendingRequests.get(id)?.cleanup?.()
          this.pendingRequests.delete(id)
          reject(new Error(`Codex app-server request timed out: ${method}`))
          if (method === 'userVerification/verify')
            void this.sendRequest('userVerification/cancel', { requestId: id }).catch((error) =>
              console.error('Unable to cancel device verification.', error)
            )
        },
        method === 'userVerification/verify'
          ? 120_000
          : method === 'thread/list'
            ? threadListRequestTimeoutMs
            : requestTimeoutMs
      )

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout,
        cleanup: () => options?.signal?.removeEventListener('abort', abort)
      })
      options?.signal?.addEventListener('abort', abort, { once: true })

      try {
        this.write({ id, method, params })
      } catch (error) {
        console.error(`Unable to send Codex app-server request ${method}`, error)
        clearTimeout(timeout)
        this.pendingRequests.get(id)?.cleanup?.()
        this.pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private sendNotification = (method: string): void => {
    this.write({ method })
  }

  private write = (message: unknown): void => {
    if (!this.process?.stdin.writable) throw new Error('Codex app-server is not running')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine = (line: string): void => {
    let message: Record<string, unknown>

    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch (error) {
      console.error('Unable to parse a Codex app-server message', error)
      return
    }

    const method = message.method
    if (typeof method === 'string') {
      if (typeof message.id === 'number') {
        this.handleServerRequest({
          id: message.id,
          method,
          params: 'params' in message ? message.params : undefined
        })
      } else {
        const notification = {
          method,
          params: 'params' in message ? message.params : undefined
        }

        if (method === 'thread/closed') {
          const threadId = (notification.params as { threadId?: string } | undefined)?.threadId
          if (threadId) {
            this.ownedThreadIds.delete(threadId)
            this.browserSessionCwds.delete(threadId)
          }
        }
        this.notificationListeners.forEach((listener) => listener(notification))
      }

      return
    }

    const response = message as RpcResponse
    if (typeof response.id !== 'number') return

    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    pending.cleanup?.()
    this.pendingRequests.delete(response.id)

    if (response.error) {
      console.error('Codex app-server request failed', response.error)
      pending.reject(
        Object.assign(new Error(response.error.message), {
          code: response.error.code,
          data: response.error.data
        })
      )
      return
    }

    pending.resolve(response.result)
  }

  private handleServerRequest = (request: RpcRequest): void => {
    if (request.method === 'item/tool/call') {
      const owner = this.process
      void this.dynamicTools
        .call(request.params)
        .then((result) => {
          if (owner && this.process === owner && owner.stdin.writable)
            this.resolveServerRequest(request.id, result)
        })
        .catch((error) => console.error('Unable to return a client tool result', error))
      return
    }
    if (request.method === 'currentTime/read') {
      this.resolveServerRequest(request.id, { currentTimeAt: Math.floor(Date.now() / 1_000) })
      return
    }

    for (const listener of this.serverRequestListeners) {
      try {
        if (listener(request)) return
      } catch (error) {
        console.error(`Codex server request listener failed for ${request.method}`, error)
        this.rejectServerRequest(
          request.id,
          error instanceof Error ? error.message : String(error),
          -32603
        )
        return
      }
    }

    this.rejectServerRequest(request.id, `Unsupported server request: ${request.method}`, -32601)
  }

  private handleProcessEnd = (error: Error): void => {
    this.desktopTools?.close()
    this.dynamicTools.clear()
    this.ownedThreadIds.clear()
    removeBrowserUseSessions(this)
    const child = this.process
    this.process = null
    this.startPromise = null
    this.rejectPending(error)
    child?.kill()
    if (child) {
      console.error('Codex app-server stopped unexpectedly', error)
      this.stoppedListeners.forEach((listener) => listener(error))
    }
  }

  private rejectPending = (error: Error): void => {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.cleanup?.()
      pending.reject(error)
    }

    this.pendingRequests.clear()
  }
}
