import type { ProviderChat, ProviderChatDetail, ProviderId } from '../../shared/provider'

type Scope = { key: string; current: () => boolean }
type Job = { provider: ProviderId; chat: ProviderChat; scope: Scope; fingerprint: string }
type Dependencies = {
  scope: (provider: ProviderId, chat: ProviderChat) => Scope | null
  read: (provider: ProviderId, chat: ProviderChat) => Promise<ProviderChatDetail>
  publish: (provider: ProviderId, detail: ProviderChatDetail) => void
  failed: (provider: ProviderId, chatId: string, error: unknown) => void
}

/** Reconcile unresolved opening views through the same bounded history paths as selection. */
export class BackgroundChatRecovery {
  private jobs = new Map<string, Job>()
  private running = new Set<string>()
  private queued = new Set<string>()
  private queue: string[] = []
  private completed = new Map<string, { fingerprint: string; scope: Scope }>()
  private disposed = false
  private dependencies: Dependencies

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies
  }

  observe(provider: ProviderId, chats: ProviderChat[]): void {
    if (this.disposed) return
    for (const chat of chats) {
      const scope = this.dependencies.scope(provider, chat)
      if (!scope?.current()) continue
      const key = JSON.stringify([provider, scope.key])
      if (chat.done || chat.purpose || (chat.status === null && chat.lastTurnOutcome === null)) {
        // A fresh terminal listing supersedes an older recovery already in flight.
        this.jobs.delete(key)
        continue
      }
      const fingerprint = JSON.stringify([
        chat.accountId,
        chat.updatedAt,
        chat.status,
        chat.lastTurnOutcome
      ])
      const previous = this.jobs.get(key)
      const completed = this.completed.get(key)
      if (
        (previous?.fingerprint === fingerprint && previous.scope.current()) ||
        (completed?.fingerprint === fingerprint && completed.scope.current())
      )
        continue
      this.jobs.set(key, { provider, chat, scope, fingerprint })
      this.enqueue(key)
    }
    this.drain()
  }

  dispose(): void {
    this.disposed = true
    this.jobs.clear()
    this.queue = []
    this.queued.clear()
    this.completed.clear()
  }

  private enqueue(key: string): void {
    if (this.running.has(key) || this.queued.has(key)) return
    this.queued.add(key)
    this.queue.push(key)
  }

  private drain(): void {
    while (!this.disposed && this.running.size < 2 && this.queue.length) {
      const key = this.queue.shift()!
      this.queued.delete(key)
      const job = this.jobs.get(key)
      if (!job) continue
      if (!job.scope.current()) {
        this.jobs.delete(key)
        continue
      }
      this.running.add(key)
      void Promise.resolve()
        .then(() => {
          if (!this.disposed && this.jobs.get(key) === job && job.scope.current())
            return this.dependencies.read(job.provider, job.chat)
          return undefined
          return undefined
        })
        .then((detail) => {
          if (!detail || this.disposed || this.jobs.get(key) !== job || !job.scope.current()) return
          this.dependencies.publish(job.provider, detail)
          this.completed.set(key, { fingerprint: job.fingerprint, scope: job.scope })
          while (this.completed.size > 2_000)
            this.completed.delete(this.completed.keys().next().value!)
        })
        .catch((error: unknown) => {
          if (!this.disposed && this.jobs.get(key) === job && job.scope.current())
            this.dependencies.failed(job.provider, job.chat.id, error)
        })
        .finally(() => {
          this.running.delete(key)
          if (this.jobs.get(key) === job) this.jobs.delete(key)
          else if (this.jobs.has(key)) this.enqueue(key)
          this.drain()
        })
    }
  }
}
