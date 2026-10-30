import type { Worker } from 'node:worker_threads'
import createWorker from './sqlite.worker?nodeWorker'
import type { SqliteOperation, SqliteWorkerOptions, SqliteWorkerReply } from './sqliteProtocol'

/** One ordered SQLite connection. No native calls or filesystem work run in its caller. */
export class SqliteWorkerClient {
  private readonly worker: Worker
  private sequence = 0
  private closed = false
  private closing: Promise<void> | null = null
  private failure: Error | null = null
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  constructor(options: SqliteWorkerOptions) {
    const worker = createWorker({ workerData: options })
    this.worker = worker
    worker.on('message', (reply: SqliteWorkerReply) => {
      if (reply.fatal) {
        this.fail(
          Object.assign(new Error(reply.error?.message ?? 'SQLite worker failed.'), reply.error)
        )
        return
      }
      const request = this.pending.get(reply.id)
      if (!request) return
      this.pending.delete(reply.id)
      if (reply.error) request.reject(Object.assign(new Error(reply.error.message), reply.error))
      else request.resolve(reply.result)
      if (!this.pending.size) worker.unref()
    })
    worker.on('error', (error) => this.fail(error))
    worker.on('exit', (code) => {
      if (!this.closed || this.pending.size)
        this.fail(new Error(`SQLite worker stopped (${code}).`))
    })
    worker.unref()
  }

  request<Result>(operation: SqliteOperation): Promise<Result> {
    if (this.failure || this.closed)
      return Promise.reject(this.failure ?? new Error('SQLite worker closed.'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as Result), reject })
      this.worker.ref()
      try {
        this.worker.postMessage({ id, operation })
      } catch (error) {
        this.pending.delete(id)
        if (!this.pending.size) this.worker.unref()
        throw error
      }
    })
  }

  // This is exclusively a document-close barrier. Preference data has its own
  // connection/file, so it can never wait for a transaction needing this thread.
  commitPreferences(operation: Extract<SqliteOperation, { kind: 'preferences' }>): void {
    if (this.failure || this.closed) throw this.failure ?? new Error('SQLite worker closed.')
    const barrier = new SharedArrayBuffer(8 + 8192)
    const state = new Int32Array(barrier, 0, 2)
    this.worker.postMessage({ id: 0, operation, barrier })
    if (Atomics.wait(state, 0, 0, 10_000) === 'timed-out') {
      const error = new Error('Preference close commit timed out.')
      this.fail(error)
      throw error
    }
    if (Atomics.load(state, 0) !== 1) {
      throw new Error(new TextDecoder().decode(new Uint8Array(barrier, 8, Atomics.load(state, 1))))
    }
  }

  private fail(error: Error): void {
    this.failure ??= error
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
    void this.worker.terminate()
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    const closing = this.failure ? Promise.resolve() : this.request({ kind: 'close' })
    this.closed = true
    this.closing = (async () => {
      try {
        await closing
      } finally {
        await this.worker.terminate()
      }
    })()
    return this.closing
  }
}
