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
import { getBrowserAutomationService } from '../../browser/BrowserAutomation'
import { createOpenCodeBrowserBridge } from './OpenCodeBrowserBridge'
import type { BrowserAutomationScope } from '../../../shared/browser'
import type { BrowserMcpIntegration } from '../../browser/BrowserMcpServer'

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
  private generation = 0
  private browser: Awaited<ReturnType<typeof createOpenCodeBrowserBridge>> | null = null

  registerBrowser = async (
    scope: BrowserAutomationScope
  ): Promise<BrowserMcpIntegration | null> => {
    await this.getClient()
    return this.browser?.register(scope) ?? null
  }

  getClient = (): Promise<OpencodeClient> => {
    if (!this.startPromise) {
      const generation = this.generation
      this.startPromise = this.start(generation).catch(async (error: unknown) => {
        if (generation === this.generation) await this.dispose()
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
    this.generation += 1
    const child = this.process
    const targetPid = this.targetPid
    this.process = null
    this.startPromise = null
    this.targetPid = null
    const browser = this.browser
    this.browser = null
    // Signal the server first: quitting must not depend on the awaits below finishing.
    child?.kill()
    await browser?.close()
    if (targetPid != null) await this.stopTargetProcess(targetPid)
  }

  private start = async (generation: number): Promise<OpencodeClient> => {
    let ownedBrowser: Awaited<ReturnType<typeof createOpenCodeBrowserBridge>> | null = null
    const checkCurrent = (): void => {
      if (generation !== this.generation) throw new Error('OpenCode server startup was canceled')
    }
    if (!(await supportsOpenCodeServerContainer(this.container))) {
      throw new Error(
        'OpenCode server mode is not available for separately selected Docker, Podman, or SSH targets. Use the host, current container, Distrobox, or Toolbox source.'
      )
    }

    const [port, hostBridge] = await Promise.all([
      reserveLocalPort(),
      getCurrentContainerHostBridge()
    ])
    checkCurrent()
    let serverEnv = process.env
    const browserService = getBrowserAutomationService()
    if (!this.container && browserService) {
      try {
        // Merge only the ephemeral process environment; never write OpenCode user/project config.
        const content = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}')
        ownedBrowser = await createOpenCodeBrowserBridge(browserService)
        checkCurrent()
        this.browser = ownedBrowser
        serverEnv = {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            ...content,
            plugin: [...(content.plugin ?? []), ownedBrowser.pluginUrl]
          })
        }
      } catch (error) {
        console.error('Unable to initialize the OpenCode browser plugin.', error)
        await ownedBrowser?.close()
        if (this.browser === ownedBrowser) this.browser = null
        checkCurrent()
      }
    }
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
      env: serverEnv
    }).catch((error: unknown) => {
      throw getOpenCodeExecutableError(error)
    })
    checkCurrent()
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
      let ownedTargetPid: number | null = null
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
          if (this.process === child) this.targetPid = null
          if (ownedTargetPid != null) void this.stopTargetProcess(ownedTargetPid)
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
        if (Number.isSafeInteger(targetPid) && targetPid > 0) {
          ownedTargetPid = targetPid
          if (this.process === child) this.targetPid = targetPid
        }
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
    }).catch(async (error) => {
      await ownedBrowser?.close()
      if (this.browser === ownedBrowser) this.browser = null
      throw error
    })

    child.on('close', (code) => {
      if (this.process !== child) return
      this.process = null
      this.startPromise = null
      this.targetPid = null
      const browser = this.browser
      this.browser = null
      void browser
        ?.close()
        .catch((error) => console.error('Unable to close OpenCode browser.', error))
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
      checkCurrent()
      return client
    } catch (error) {
      if (generation === this.generation) await this.dispose()
      throw error
    }
  }

  private stopTargetProcess = async (targetPid: number): Promise<void> => {
    const command = await getHostCommand('kill', ['-TERM', String(targetPid)], {
      container: this.container,
      env: process.env
    }).catch((error) => {
      console.error('[caught:OpenCodeServerClient:stopTargetProcess]', error)
      return null
    })
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
