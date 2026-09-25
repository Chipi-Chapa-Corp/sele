import type { Worker } from 'node:worker_threads'
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
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
      resolve: (sessions: SDKSessionInfo[]) => void
      reject: (error: Error) => void
    }
  >()
  private requests = new Map<string, Promise<SDKSessionInfo[]>>()
  private snapshots = new Map<string, { expiresAt: number; sessions: SDKSessionInfo[] }>()

  list(container: AppContainerTarget | null, reuseSnapshot = false): Promise<SDKSessionInfo[]> {
    if (this.disposed) return Promise.reject(new Error('Claude session discovery disposed'))
    const key = getContainerTargetKey(container)
    const existing = this.requests.get(key)
    if (existing) return existing
    const cached = this.snapshots.get(key)
    if (reuseSnapshot && cached && cached.expiresAt > Date.now())
      return Promise.resolve(cached.sessions)
    this.snapshots.delete(key)
    const worker = this.getWorker()
    const id = ++this.nextId
    const request = new Promise<SDKSessionInfo[]>((resolve, reject) => {
      this.pending.set(id, { container, resolve, reject })
      worker.postMessage({ type: 'list', id, remote: Boolean(container) })
    })
      .then((sessions) => {
        // Reuse one discovery snapshot across pages and simultaneous background refreshes.
        this.snapshots.set(key, { sessions, expiresAt: Date.now() + 30_000 })
        return sessions
      })
      .finally(() => this.requests.delete(key))
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
        else pending?.resolve(message.sessions)
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
    this.snapshots.clear()
  }
}
