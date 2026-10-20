import type { Worker } from 'node:worker_threads'
import type { ChatImportPreview, SeleChatArchive } from '../../shared/chatArchive'
import type { restoreArchiveAssets } from './ChatArchive'
import createWorker from './chatArchive.worker?nodeWorker'

type AssetFiles = NonNullable<Parameters<typeof restoreArchiveAssets>[2]>

/** Archive parsing, Markdown scanning and JSON serialization must not block the app process. */
export class ChatArchiveWorker {
  private worker: Worker | null = null
  private nextId = 0
  private disposed = false
  private files: AssetFiles | undefined
  private fileWrites = new Set<Promise<void>>()
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  private request<T>(task: Record<string, unknown>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Chat import cancelled.'))
    if (!this.worker) {
      const worker = createWorker({})
      this.worker = worker
      worker.on('message', (message) => {
        if (message.type === 'file') {
          const files = this.files
          const action = files
            ? message.data == null
              ? files.mkdir(message.path)
              : files.write(message.path, Buffer.from(message.data))
            : Promise.reject(new Error('Import workspace is unavailable.'))
          this.fileWrites.add(action)
          void action
            .then(
              () => worker.postMessage({ type: 'fileResult', id: message.id }),
              (error) =>
                worker.postMessage({ type: 'fileResult', id: message.id, error: String(error) })
            )
            .finally(() => this.fileWrites.delete(action))
          return
        }
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) pending?.reject(new Error(message.error))
        else pending?.resolve(message.value)
        if (!this.pending.size) worker.unref()
      })
      worker.on('error', (error) => this.fail(worker, error))
      worker.on('exit', () => this.fail(worker, new Error('Chat archive worker stopped.')))
    }
    const worker = this.worker
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      worker.ref()
      worker.postMessage({ ...task, id })
    })
  }

  read(path: string, id: string): Promise<ChatImportPreview> {
    return this.request({ type: 'read', path, importId: id })
  }

  async restore(directory: string, files: AssetFiles): Promise<SeleChatArchive> {
    this.files = files
    try {
      return await this.request({ type: 'restore', directory })
    } finally {
      // Finish an in-flight destination write before cancellation removes the workspace.
      await Promise.allSettled([...this.fileWrites])
      this.files = undefined
    }
  }

  parse<T>(json: string): Promise<T> {
    return this.request({ type: 'parse', json })
  }

  stringify(value: unknown): Promise<string> {
    return this.request({ type: 'stringify', value })
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    void worker.terminate()
  }

  dispose(): void {
    this.disposed = true
    if (this.worker) this.fail(this.worker, new Error('Chat import cancelled.'))
  }
}
