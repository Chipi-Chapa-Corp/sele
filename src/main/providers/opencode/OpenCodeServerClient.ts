import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2'
import type { AppContainerTarget } from '../../../shared/app'
import { getCurrentContainerHostBridge, isCurrentContainerTarget } from '../../currentContainer'
import { getHostCommand, isRunningInFlatpak } from '../../hostProcess'
import { quotePosixShellArg } from '../../targetShell'
import { getOpenCodeExecutable, getOpenCodeExecutableError } from './OpenCodeExecutable'

const serverStartupTimeoutMs = 15_000
const serverOutputLimit = 4_000
const serverStopTimeoutMs = 5_000
const serverPidMarker = '__SELE_OPENCODE_SERVER_PID__='

const reserveLocalPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (port == null) reject(new Error('Unable to reserve a port for OpenCode.'))
        else resolve(port)
      })
    })
  })

export const supportsOpenCodeServerContainer = async (
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  if (!container || container.kind === 'host') return true
  if (container.tool === 'distrobox' || container.tool === 'toolbox') return true
  return isCurrentContainerTarget(container)
}

export class OpenCodeServerClient {
  constructor(private readonly container: AppContainerTarget | null = null) {}

  private process: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<OpencodeClient> | null = null
  private exitListeners = new Set<(error: Error) => void>()
  private stderr = ''
  private targetPid: number | null = null

  getClient = (): Promise<OpencodeClient> => {
    if (!this.startPromise) {
      this.startPromise = this.start().catch((error: unknown) => {
        this.startPromise = null
        throw error
      })
    }
    return this.startPromise
  }

  onExit = (listener: (error: Error) => void): (() => void) => {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  dispose = async (): Promise<void> => {
    const child = this.process
    const targetPid = this.targetPid
    this.process = null
    this.startPromise = null
    this.targetPid = null
    if (targetPid != null) await this.stopTargetProcess(targetPid)
    child?.kill()
  }

  private start = async (): Promise<OpencodeClient> => {
    if (!(await supportsOpenCodeServerContainer(this.container))) {
      throw new Error(
        'OpenCode server mode is not available for separately selected Docker, Podman, or SSH targets. Use the host, current container, Distrobox, or Toolbox source.'
      )
    }

    const [port, hostBridge] = await Promise.all([
      reserveLocalPort(),
      getCurrentContainerHostBridge()
    ])
    const executable = this.container?.kind === 'container' ? 'opencode' : getOpenCodeExecutable()
    const serverArgs = ['serve', '--hostname', '127.0.0.1', '--port', String(port)]
    const usesCommandWrapper =
      Boolean(this.container) || Boolean(hostBridge) || isRunningInFlatpak()
    const commandFile = usesCommandWrapper ? 'sh' : executable
    const commandArgs = usesCommandWrapper
      ? [
          '-c',
          `printf '${serverPidMarker}%s\\n' "$$"; exec ${[executable, ...serverArgs]
            .map(quotePosixShellArg)
            .join(' ')}`
        ]
      : serverArgs
    const hostCommand = await getHostCommand(commandFile, commandArgs, {
      container: this.container,
      cwd: homedir(),
      env: process.env
    }).catch((error: unknown) => {
      throw getOpenCodeExecutableError(error)
    })
    const password = randomBytes(24).toString('base64url')
    const child = spawn(hostCommand.file, hostCommand.args, {
      cwd: hostCommand.cwd,
      env: {
        ...hostCommand.env,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_SERVER_USERNAME: 'opencode'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.process = child
    this.stderr = ''

    const url = await new Promise<string>((resolve, reject) => {
      let output = ''
      let settled = false
      const timeout = setTimeout(() => {
        settle(new Error(`Timed out while starting OpenCode server. ${output.trim()}`))
      }, serverStartupTimeoutMs)

      const settle = (error?: Error, value?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) {
          const targetPid = this.targetPid
          this.targetPid = null
          if (targetPid != null) void this.stopTargetProcess(targetPid)
          child.kill()
          reject(error)
        } else {
          resolve(value!)
        }
      }
      const readOutput = (chunk: Buffer): void => {
        output = `${output}${chunk.toString()}`.slice(-serverOutputLimit)
        const pidMatch = new RegExp(`${serverPidMarker}(\\d+)`).exec(output)
        const targetPid = Number(pidMatch?.[1])
        if (Number.isSafeInteger(targetPid) && targetPid > 0) this.targetPid = targetPid
        const match = /opencode server listening on (https?:\/\/[^\s]+)/.exec(output)
        if (match?.[1]) settle(undefined, match[1])
      }

      child.stdout.on('data', readOutput)
      child.stderr.on('data', (chunk: Buffer) => {
        this.stderr = `${this.stderr}${chunk.toString()}`.slice(-serverOutputLimit)
        readOutput(chunk)
      })
      child.once('error', (error) => settle(getOpenCodeExecutableError(error)))
      child.once('close', (code) => {
        settle(
          getOpenCodeExecutableError(
            new Error(
              this.stderr.trim() || `OpenCode server exited with code ${code ?? 'unknown'}.`
            )
          )
        )
      })
    })

    child.on('close', (code) => {
      if (this.process !== child) return
      this.process = null
      this.startPromise = null
      this.targetPid = null
      const error = new Error(
        this.stderr.trim() || `OpenCode server exited with code ${code ?? 'unknown'}.`
      )
      this.exitListeners.forEach((listener) => listener(error))
    })

    const authorization = Buffer.from(`opencode:${password}`).toString('base64')
    const client = createOpencodeClient({
      baseUrl: url,
      headers: { authorization: `Basic ${authorization}` },
      throwOnError: true
    })
    try {
      await client.global.health({ throwOnError: true })
      return client
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  private stopTargetProcess = async (targetPid: number): Promise<void> => {
    const command = await getHostCommand('kill', ['-TERM', String(targetPid)], {
      container: this.container,
      env: process.env
    }).catch(() => null)
    if (!command) return

    await new Promise<void>((resolve) => {
      const child = execFile(
        command.file,
        command.args,
        {
          cwd: command.cwd,
          env: command.env,
          timeout: serverStopTimeoutMs
        },
        () => resolve()
      )
      child.stdin?.end()
    })
  }
}
