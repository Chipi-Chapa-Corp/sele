import type { ExecFileException } from 'node:child_process'
import type { Worker } from 'node:worker_threads'
import type { HostCommand } from './hostProcess'
import createWorker from './bufferedCommand.worker?nodeWorker'

export type BufferedCommandOptions = { timeout: number; maxBuffer: number; input?: string }
export type BufferedCommandResult = {
  stdout: string
  stderr: string
  error: ExecFileException | null
}
export type BufferedCommandReply = {
  id: number
  stdout: string
  stderr: string
  error: null | Pick<ExecFileException, 'message' | 'code' | 'killed' | 'signal'>
}

// Even async execFile synchronously enters native spawn. Forking from Electron's
// browser thread can stall all windows, especially with a large provider heap.
export class BufferedCommandWorker {
  private worker: Worker | null = null
  private nextId = 0
  private disposed = false
  private pending = new Map<
    number,
    { resolve: (result: BufferedCommandResult) => void; reject: (error: Error) => void }
  >()

  run(command: HostCommand, options: BufferedCommandOptions): Promise<BufferedCommandResult> {
    if (this.disposed) return Promise.reject(new Error('Command worker disposed.'))
    if (!this.worker) {
      const worker = createWorker({})
      this.worker = worker
      worker.on('message', (reply: BufferedCommandReply) => {
        const pending = this.pending.get(reply.id)
        if (!pending) return
        this.pending.delete(reply.id)
        const error = reply.error
          ? Object.assign(new Error(reply.error.message), reply.error)
          : null
        pending.resolve({ stdout: reply.stdout, stderr: reply.stderr, error })
        if (!this.pending.size) worker.unref()
      })
      worker.on('error', (error) => this.fail(worker, error))
      worker.on('exit', () => this.fail(worker, new Error('Command worker stopped.')))
    }
    const worker = this.worker
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.ref()
      try {
        worker.postMessage({ id, command, options })
      } catch (error) {
        this.pending.delete(id)
        if (!this.pending.size) worker.unref()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
    void worker.terminate()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const worker = this.worker
    if (!worker) return
    const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()))
    worker.ref()
    worker.postMessage({ dispose: true })
    const fallback = setTimeout(() => {
      void worker.terminate()
    }, 2000)
    await exited
    clearTimeout(fallback)
  }
}

export const bufferedCommands = new BufferedCommandWorker()
