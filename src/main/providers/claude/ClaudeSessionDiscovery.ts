import type { Worker } from 'node:worker_threads'
import type { ClaudeSessionListPage } from './ClaudeSessionCatalog'
import type { AppContainerTarget } from '../../../shared/app'
import { getContainerTargetKey } from '../../containerTarget'
import { getHostCommand } from '../../hostProcess'
import createWorker from './claudeSessionDiscovery.worker?nodeWorker'

export class ClaudeSessionDiscovery {
  private worker: Worker | null = null
  private nextId = 0
  private disposed = false
  private pending = new Map<
    number,
    {
      container: AppContainerTarget | null
      resolve: (page: ClaudeSessionListPage) => void
      reject: (error: Error) => void
    }
  >()
  private requests = new Map<string, Promise<ClaudeSessionListPage>>()

  list(
    container: AppContainerTarget | null,
    cursor: string | null = null,
    limit = 50,
    hiddenSessionIds: string[] = []
  ): Promise<ClaudeSessionListPage> {
    if (this.disposed) return Promise.reject(new Error('Claude session discovery disposed'))
    const scope = getContainerTargetKey(container)
    const key = JSON.stringify([scope, cursor, limit, hiddenSessionIds.toSorted()])
    const existing = this.requests.get(key)
    if (existing) return existing
    const worker = this.getWorker()
    const id = ++this.nextId
    const request = new Promise<ClaudeSessionListPage>((resolve, reject) => {
      this.pending.set(id, { container, resolve, reject })
      worker.postMessage({
        type: 'list',
        id,
        scope,
        remote: Boolean(container),
        cursor,
        limit,
        hiddenSessionIds
      })
    }).finally(() => this.requests.delete(key))
    this.requests.set(key, request)
    return request
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = createWorker({})
    this.worker = worker
    worker.on('message', (message) => {
      if (message.type === 'command') {
        const pending = this.pending.get(message.requestId)
        if (!pending) return
        void getHostCommand(
          'sh',
          ['-lc', message.script, 'sele-claude-session-store', ...message.args],
          {
            container: pending.container,
            env: process.env
          }
        ).then(
          (command) => worker.postMessage({ type: 'commandResult', id: message.id, command }),
          (error) => {
            console.error('Unable to resolve Claude discovery command.', error)
            worker.postMessage({
              type: 'commandResult',
              id: message.id,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        )
      } else if (message.type === 'result') {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) pending?.reject(new Error(message.error))
        else pending?.resolve(message.page)
      }
    })
    worker.on('error', (error) => this.fail(worker, error))
    worker.on('exit', () => this.fail(worker, new Error('Claude session discovery stopped')))
    worker.unref()
    return worker
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  dispose(): void {
    this.disposed = true
    const worker = this.worker
    if (worker) {
      this.fail(worker, new Error('Claude session discovery disposed'))
      void worker.terminate()
    }
    this.requests.clear()
  }
}
