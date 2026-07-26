import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

type RpcError = {
  code: number
  message: string
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
}

const requestTimeoutMs = 30_000
const codexResourceMemoryHigh = '2G'

type AppServerCommand = {
  command: string
  args: string[]
}

const getAppServerCommand = (binary: string): AppServerCommand => {
  const appServerArgs = ['app-server', '--listen', 'stdio://']
  const canUseSystemd =
    process.platform === 'linux' &&
    Boolean(process.env.DBUS_SESSION_BUS_ADDRESS) &&
    process.env.SELE_DISABLE_CODEX_RESOURCE_ISOLATION !== '1'

  if (!canUseSystemd) {
    return {
      command: binary,
      args: appServerArgs
    }
  }

  return {
    command: 'systemd-run',
    args: [
      '--user',
      '--pipe',
      '--wait',
      '--collect',
      '--quiet',
      `--unit=sele-codex-${process.pid}-${Date.now()}`,
      '--property=CPUWeight=25',
      '--property=IOWeight=25',
      `--property=MemoryHigh=${codexResourceMemoryHigh}`,
      '--property=OOMScoreAdjust=500',
      binary,
      ...appServerArgs
    ]
  }
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<void> | null = null
  private pendingRequests = new Map<number, PendingRequest>()
  private notificationListeners = new Set<(notification: RpcNotification) => void>()
  private serverRequestListeners = new Set<(request: RpcRequest) => boolean | void>()
  private nextRequestId = 1
  private stderr = ''

  request = async <Result>(method: string, params: unknown): Promise<Result> => {
    await this.start()
    return this.sendRequest<Result>(method, params)
  }

  onNotification = (listener: (notification: RpcNotification) => void): (() => void) => {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onServerRequest = (listener: (request: RpcRequest) => boolean | void): (() => void) => {
    this.serverRequestListeners.add(listener)
    return () => this.serverRequestListeners.delete(listener)
  }

  resolveServerRequest = (id: number, result: unknown): void => {
    this.write({ id, result })
  }

  rejectServerRequest = (id: number, message: string, code = -32603): void => {
    this.write({ id, error: { code, message } })
  }

  dispose = (): void => {
    this.process?.kill()
    this.process = null
    this.startPromise = null
    this.rejectPending(new Error('Codex app-server stopped'))
  }

  private start = async (): Promise<void> => {
    if (!this.startPromise) {
      this.startPromise = this.initialize().catch((error: unknown) => {
        this.startPromise = null
        throw error
      })
    }

    return this.startPromise
  }

  private initialize = async (): Promise<void> => {
    const binary = process.env.CODEX_BINARY_PATH || 'codex'
    const appServerCommand = getAppServerCommand(binary)
    const child = spawn(appServerCommand.command, appServerCommand.args, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.process = child
    this.stderr = ''

    createInterface({ input: child.stdout }).on('line', this.handleLine)

    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-2_000)
    })

    child.on('error', (error) => {
      this.handleProcessEnd(error)
    })

    child.on('close', (code) => {
      const detail = this.stderr.trim()
      const message = detail || `Codex app-server exited with code ${code ?? 'unknown'}`
      this.handleProcessEnd(new Error(message))
    })

    await this.sendRequest('initialize', {
      clientInfo: { name: 'sele', title: 'Sele', version: '1.0.0' },
      capabilities: null
    })

    this.sendNotification('initialized')
  }

  private sendRequest = <Result>(method: string, params: unknown): Promise<Result> => {
    const id = this.nextRequestId++

    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, requestTimeoutMs)

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout
      })

      try {
        this.write({ id, method, params })
      } catch (error) {
        clearTimeout(timeout)
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
    } catch {
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

        this.notificationListeners.forEach((listener) => listener(notification))
      }

      return
    }

    const response = message as RpcResponse
    if (typeof response.id !== 'number') return

    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(response.error.message))
      return
    }

    pending.resolve(response.result)
  }

  private handleServerRequest = (request: RpcRequest): void => {
    for (const listener of this.serverRequestListeners) {
      try {
        if (listener(request)) return
      } catch (error) {
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
    this.process = null
    this.startPromise = null
    this.rejectPending(error)
  }

  private rejectPending = (error: Error): void => {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }

    this.pendingRequests.clear()
  }
}
