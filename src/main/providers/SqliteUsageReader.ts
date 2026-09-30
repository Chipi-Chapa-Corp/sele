import type { Worker } from 'node:worker_threads'
import type { HostCommand } from '../hostProcess'
import createWorker from './sqliteUsage.worker?nodeWorker'

export type SqliteUsageRead = {
  path?: string
  command?: HostCommand
  table: string
  requiredColumns: string[]
  query: string
  queryWithoutDetails: string
}

/** Bounded snapshots and coalesced requests; SQLite work never runs on Electron's UI thread. */
export class SqliteUsageReader<T> {
  private worker: Worker | null = null
  private nextId = 0
  private disposed = false
  private requests = new Map<string, Promise<T[] | null>>()
  private snapshots = new Map<string, { expiresAt: number; value: T[] | null }>()
  private pending = new Map<
    number,
    {
      resolve: (value: T[] | null) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  read(key: string, options: () => Promise<SqliteUsageRead>): Promise<T[] | null> {
    if (this.disposed) return Promise.reject(new Error('Usage reader disposed'))
    const existing = this.requests.get(key)
    if (existing) return existing
    const cached = this.snapshots.get(key)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
    const request = options()
      .then((options) => {
        const worker = this.getWorker()
        const id = ++this.nextId
        return new Promise<T[] | null>((resolve, reject) => {
          const timer = setTimeout(
            () => this.fail(worker, new Error('Historical usage read timed out.')),
            20_000
          )
          this.pending.set(id, { resolve, reject, timer })
          worker.postMessage({ id, options })
        })
      })
      .then((value) => {
        if (!this.disposed) {
          this.snapshots.delete(key)
          this.snapshots.set(key, { value, expiresAt: Date.now() + 15_000 })
          // A long navigation session cannot accumulate an unbounded number of chat snapshots.
          if (this.snapshots.size > 100) this.snapshots.delete(this.snapshots.keys().next().value!)
        }
        return value
      })
      .finally(() => this.requests.delete(key))
    this.requests.set(key, request)
    return request
  }

  private getWorker(): Worker {
    if (this.disposed) throw new Error('Usage reader disposed')
    if (this.worker) return this.worker
    const worker = createWorker({})
    this.worker = worker
    worker.on('message', (message) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.rows)
    })
    worker.on('error', (error) => this.fail(worker, error))
    worker.on('exit', () => this.fail(worker, new Error('Usage reader stopped')))
    worker.unref()
    return worker
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    void worker.terminate()
  }

  dispose(): void {
    this.disposed = true
    if (this.worker) this.fail(this.worker, new Error('Usage reader disposed'))
    this.snapshots.clear()
  }
}
