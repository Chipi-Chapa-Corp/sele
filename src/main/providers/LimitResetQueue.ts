import { nextLimitReset, limitResetKey } from '../../shared/limitReset.ts'
import { randomUUID } from 'node:crypto'
import type {
  ProviderAccountRateLimit,
  ProviderId,
  ProviderLimitResetMessage,
  ProviderStartChatOptions,
  ProviderLimitResetTarget
} from '../../shared/provider'

export { nextLimitReset } from '../../shared/limitReset.ts'

export type LimitResetEntry = ProviderLimitResetMessage & {
  providerId: ProviderId
  chatId: string | null
  draftKey?: string
  worktree?: boolean
  accountId?: string
  workspacePrepared?: boolean
  options: ProviderStartChatOptions
  limitKey: string
  usedPercent: number
}

export type LimitResetBackend = {
  list: () => Promise<LimitResetEntry[]>
  put: (entry: LimitResetEntry) => Promise<void>
  remove: (id: string) => Promise<void>
}

const matchesTarget = (entry: LimitResetEntry, target: ProviderLimitResetTarget): boolean =>
  typeof target === 'string' ? entry.chatId === target : entry.draftKey === target.draftKey

/** Persist native identity before the initial prompt can be delivered, including sibling prompts. */
export const bindLimitResetDraftChat = async (
  backend: LimitResetBackend,
  entry: LimitResetEntry,
  chatId: string,
  options: ProviderStartChatOptions
): Promise<void> => {
  for (const stored of await backend.list()) {
    if (
      stored.id !== entry.id &&
      !(
        entry.draftKey &&
        stored.providerId === entry.providerId &&
        stored.draftKey === entry.draftKey &&
        stored.accountId === entry.accountId &&
        !stored.chatId
      )
    )
      continue
    await backend.put({
      ...stored,
      chatId,
      workspacePrepared: true,
      options: {
        ...stored.options,
        cwd: options.cwd,
        additionalDirectories: options.additionalDirectories
      }
    })
  }
  entry.chatId = chatId
  entry.workspacePrepared = true
  entry.options = {
    ...entry.options,
    cwd: options.cwd,
    additionalDirectories: options.additionalDirectories
  }
}

/** A process-independent deadline releases messages even when Sele missed the reset event. */
export class LimitResetQueue {
  private work: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  private readonly backend: LimitResetBackend
  private readonly deliver: (entry: LimitResetEntry) => Promise<void>
  private readonly now: () => number

  constructor(
    backend: LimitResetBackend,
    deliver: (entry: LimitResetEntry) => Promise<void>,
    now: () => number = Date.now
  ) {
    this.backend = backend
    this.deliver = deliver
    this.now = now
  }

  private serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = this.work.then(action)
    this.work = result.catch(() => {})
    return result
  }

  list = (
    providerId: ProviderId,
    target: ProviderLimitResetTarget
  ): Promise<ProviderLimitResetMessage[]> =>
    this.serial(async () =>
      (await this.backend.list())
        .filter((entry) => entry.providerId === providerId && matchesTarget(entry, target))
        .map(({ id, content, createdAt, resetsAt, error }) => ({
          id,
          content,
          createdAt,
          resetsAt,
          error
        }))
    )

  add = (
    providerId: ProviderId,
    target: ProviderLimitResetTarget,
    content: string,
    options: ProviderStartChatOptions,
    limits: ProviderAccountRateLimit[],
    usageScope?: string,
    accountId?: string
  ): Promise<void> =>
    this.serial(async () => {
      content = content.trim()
      if (!content) throw new Error('Cannot queue an empty message')
      const createdAt = this.now()
      const reset = nextLimitReset(limits, createdAt, usageScope)
      if (!reset)
        throw new Error('The next limit reset time is unavailable. Refresh limits and try again.')
      await this.backend.put({
        id: randomUUID(),
        providerId,
        chatId: typeof target === 'string' ? target : null,
        ...(typeof target === 'string'
          ? {}
          : { draftKey: target.draftKey, worktree: target.worktree }),
        accountId,
        content,
        options,
        createdAt,
        resetsAt: reset.resetsAt,
        limitKey: limitResetKey(reset.limit),
        usedPercent: reset.limit.usedPercent
      })
      this.schedule(0)
    })

  remove = (
    providerId: ProviderId,
    target: ProviderLimitResetTarget,
    id: string,
    cancelHandoff?: (entry: LimitResetEntry) => Promise<void>
  ): Promise<void> =>
    this.serial(async () => {
      const entry = (await this.backend.list()).find((entry) => entry.id === id)
      if (!entry || entry.providerId !== providerId || !matchesTarget(entry, target)) return
      await cancelHandoff?.(entry)
      await this.backend.remove(id)
    })

  /** Also recognize an early/manual reset reported by the same chat's account. */
  observe = (
    providerId: ProviderId,
    chatId: string,
    limits: ProviderAccountRateLimit[]
  ): Promise<void> =>
    this.serial(async () => {
      for (const entry of await this.backend.list()) {
        if (entry.providerId !== providerId || entry.chatId !== chatId) continue
        const limit = limits.find((limit) => limitResetKey(limit) === entry.limitKey)
        if (limit && limit.usedPercent < entry.usedPercent && limit.usedPercent < 100) {
          await this.backend.put({ ...entry, resetsAt: Math.min(entry.resetsAt, this.now()) })
        }
      }
      this.schedule(0)
    })

  tick = (): Promise<void> =>
    this.serial(async () => {
      const entries = await this.backend.list()
      const blockedChats = new Set<string>()
      for (const snapshot of entries) {
        const entry = (await this.backend.list()).find((stored) => stored.id === snapshot.id)
        if (!entry) continue
        const key = `${entry.providerId}:${entry.chatId ?? entry.draftKey}:${entry.accountId ?? ''}`
        if (entry.resetsAt > this.now() || blockedChats.has(key)) continue
        try {
          await this.deliver(entry)
          await this.backend.remove(entry.id)
        } catch (error) {
          console.error('Unable to release a message after limit reset.', error)
          blockedChats.add(key)
          // The provider may already have committed the atomic handoff. Never recreate
          // an outbox entry after it has become a durable normal queued message.
          const stored = (await this.backend.list()).find((stored) => stored.id === entry.id)
          if (stored) {
            await this.backend.put({
              ...stored,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
      const future = entries
        .filter((entry) => entry.resetsAt > this.now())
        .map((entry) => entry.resetsAt - this.now())
      this.schedule(Math.min(30_000, ...future))
    })

  start = (): void => {
    this.running = true
    this.schedule(0)
  }

  close = async (): Promise<void> => {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.work
  }

  private schedule = (delay: number): void => {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(
      () => {
        this.timer = null
        void this.tick().catch((error) => {
          console.error('Unable to check the limit reset queue.', error)
          this.schedule(30_000)
        })
      },
      Math.max(0, delay)
    )
    this.timer.unref?.()
  }
}
