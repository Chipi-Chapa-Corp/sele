import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { app } from 'electron'
import { getHostCommand } from '../hostProcess'
import type { DesktopState } from '../../shared/desktop'

export class ComputerAutomation {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<
    number,
    {
      resolve(value: Record<string, unknown>): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private nextId = 0
  private executing = false
  private generation = 0
  private state: DesktopState['computer'] = {
    connected: false,
    connecting: false,
    backend: null,
    error: null
  }
  get status(): DesktopState['computer'] {
    return { ...this.state }
  }

  async connect(): Promise<void> {
    if (this.state.connected || this.state.connecting) return
    const generation = ++this.generation
    this.state = { connected: false, connecting: true, backend: null, error: null }
    try {
      if (process.platform !== 'linux')
        throw new Error(
          'The native desktop backend currently supports Linux. Chrome attachment is available separately.'
        )
      const script = await readFile(join(app.getAppPath(), 'resources/computer-helper.py'), 'utf8')
      const command = await getHostCommand('python3', ['-u', '-c', script])
      if (generation !== this.generation) return
      const child = spawn(command.file, command.args, {
        env: command.env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.child = child
      let diagnostics = ''
      child.stderr.on('data', (data) => {
        diagnostics = (diagnostics + String(data)).slice(-2000)
      })
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (this.child !== child) return
        try {
          const message = JSON.parse(line)
          if (message.event === 'disconnected') {
            this.disconnect()
            return
          }
          const pending = this.pending.get(message.id)
          if (!pending) return
          clearTimeout(pending.timer)
          this.pending.delete(message.id)
          if (typeof message.error === 'string') pending.reject(new Error(message.error))
          else pending.resolve(message.result ?? {})
        } catch (error) {
          console.error('Invalid native computer response.', error)
        }
      })
      const ended = (error: Error): void => {
        if (this.child !== child) return
        this.child = null
        this.state = { connected: false, connecting: false, backend: null, error: error.message }
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.reject(error)
        }
        this.pending.clear()
      }
      child.on('error', ended)
      child.stdin.on('error', ended)
      child.on('exit', () => ended(new Error(diagnostics.trim() || 'Desktop sharing has ended.')))
      const result = await this.request({ action: 'connect' }, 150_000)
      if (generation !== this.generation) return
      this.state = {
        connected: true,
        connecting: false,
        backend: String(result.backend),
        error: null
      }
    } catch (error) {
      if (generation === this.generation) {
        this.disconnect()
        this.state.error = error instanceof Error ? error.message : String(error)
      }
      throw error
    }
  }

  disconnect(): void {
    this.generation++
    const child = this.child
    this.child = null
    child?.stdin.end()
    if (child) {
      const timer = setTimeout(() => child.kill(), 1500)
      timer.unref()
      child.once('exit', () => clearTimeout(timer))
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Desktop sharing was disconnected.'))
    }
    this.pending.clear()
    this.state = { connected: false, connecting: false, backend: null, error: null }
  }

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.state.connected)
      throw new Error('Connect native computer control in Settings → Browser & desktop first.')
    if (input.action === 'connect' || input.action === 'disconnect')
      throw new Error('Desktop connections are controlled by the user in Settings.')
    if (this.executing)
      throw new Error('Another native computer action is in progress. Retry after it completes.')
    this.executing = true
    try {
      return await this.request(input)
    } finally {
      this.executing = false
    }
  }

  private request(
    input: Record<string, unknown>,
    timeout = 20000
  ): Promise<Record<string, unknown>> {
    const child = this.child
    if (!child?.stdin.writable) return Promise.reject(new Error('Desktop connection is closed.'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Native computer request timed out.'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ ...input, id }) + '\n', (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }
}

export const computerAutomation = new ComputerAutomation()
