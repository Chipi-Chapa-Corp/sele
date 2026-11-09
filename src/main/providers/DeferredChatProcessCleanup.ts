import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProviderChat, ProviderChatMetadata, ProviderId } from '../../shared/provider'
import { getContainerTargetKey } from '../containerTarget.ts'

type Chat = Pick<ProviderChat, 'id' | 'providerId' | 'cwd' | 'projectCwd' | 'container'>
type Target = { id: string; providerId?: ProviderId }
type Group = {
  workspace: string
  pending: Target[]
  holders: string[]
  dueAt: number | null
}
type Dependencies = {
  file: string
  cleanup: (ids: string[], providerId?: ProviderId) => Promise<void>
  metadata: (id: string) => Promise<ProviderChatMetadata>
  onError: (error: unknown) => void
  now?: () => number
}

export const chatProcessCleanupDelayMs = 5 * 60_000

/** A replacement chat keeps its project's terminals alive until it too is marked Done. */
export class DeferredChatProcessCleanup {
  private groups: Group[] = []
  private chats = new Map<string, { workspace: string; providerId: ProviderId }>()
  private work: Promise<unknown> = Promise.resolve()
  private loaded = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly dependencies: Dependencies
  private readonly now: () => number

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies
    this.now = dependencies.now ?? Date.now
  }

  remember(chat: Chat): void {
    this.chats.set(chat.id, {
      workspace: `${getContainerTargetKey(chat.container)}\0${chat.projectCwd ?? chat.cwd ?? ''}`,
      providerId: chat.providerId
    })
  }

  start(): void {
    void this.serial(async () => {}).catch(this.dependencies.onError)
  }

  created(chat: Chat): Promise<void> {
    this.remember(chat)
    return this.retain(chat.id)
  }

  forked(id: string, providerId: ProviderId, sourceId: string): Promise<void> {
    const source = this.chats.get(sourceId)
    if (!source) return Promise.resolve()
    this.chats.set(id, { workspace: source.workspace, providerId })
    return this.retain(id)
  }

  private retain(id: string): Promise<void> {
    return this.serial(async () => {
      const workspace = this.chats.get(id)!.workspace
      const group = this.groups.find((group) => group.workspace === workspace)
      if (!group) return
      if (!group.holders.includes(id)) group.holders.push(id)
      group.dueAt = null
      await this.save()
    })
  }

  schedule(ids: string[], providerId?: ProviderId): Promise<void> {
    return this.serial(async () => {
      for (const id of new Set(ids)) {
        const known = this.chats.get(id)
        let group = this.groups.find(
          (group) => group.holders.includes(id) || group.pending.some((chat) => chat.id === id)
        )
        const workspace = known?.workspace ?? group?.workspace ?? `chat:${id}`
        group ??= this.groups.find((group) => group.workspace === workspace)
        if (!group) {
          group = { workspace, pending: [], holders: [], dueAt: null }
          this.groups.push(group)
        }
        if (!group.pending.some((chat) => chat.id === id))
          group.pending.push({ id, providerId: providerId ?? known?.providerId })
        group.holders = group.holders.filter((holder) => holder !== id)
        group.dueAt = group.holders.length ? null : this.now() + chatProcessCleanupDelayMs
      }
      await this.save()
    })
  }

  cancel(id: string): Promise<void> {
    return this.serial(async () => {
      for (const group of this.groups) {
        const pending = group.pending.some((chat) => chat.id === id)
        group.pending = group.pending.filter((chat) => chat.id !== id)
        if (pending && group.pending.length && !group.holders.includes(id)) group.holders.push(id)
        if (group.holders.includes(id)) group.dueAt = null
      }
      this.groups = this.groups.filter((group) => group.pending.length)
      await this.save()
    })
  }

  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer)
    await this.work
  }

  private serial(action: () => Promise<void>): Promise<void> {
    const result = this.work.then(async () => {
      if (this.closed) return
      if (!this.loaded) {
        try {
          const groups: Group[] = JSON.parse(await readFile(this.dependencies.file, 'utf8'))
          if (
            !Array.isArray(groups) ||
            groups.some(
              (group) =>
                !group ||
                typeof group.workspace !== 'string' ||
                !Array.isArray(group.pending) ||
                group.pending.some(
                  (target) =>
                    !target ||
                    typeof target.id !== 'string' ||
                    (target.providerId !== undefined &&
                      !['codex', 'claude', 'copilot', 'opencode-v2'].includes(target.providerId))
                ) ||
                !Array.isArray(group.holders) ||
                group.holders.some((id) => typeof id !== 'string') ||
                (group.dueAt !== null && !Number.isFinite(group.dueAt)) ||
                (group.holders.length > 0 && group.dueAt !== null)
            )
          )
            throw new Error('Invalid deferred chat process cleanup state.')
          this.groups = groups
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        this.loaded = true
      }
      try {
        await action()
      } finally {
        this.arm()
      }
    })
    this.work = result.catch(() => {})
    return result
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.dependencies.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.dependencies.file}.tmp`
    await writeFile(temporary, JSON.stringify(this.groups), { mode: 0o600 })
    await rename(temporary, this.dependencies.file)
  }

  private arm(): void {
    clearTimeout(this.timer)
    if (this.closed) return
    const next = Math.min(...this.groups.map((group) => group.dueAt ?? Infinity))
    if (!Number.isFinite(next)) return
    this.timer = setTimeout(
      () => {
        void this.serial(() => this.drain()).catch(this.dependencies.onError)
      },
      Math.max(0, Math.min(2_147_483_647, next - this.now()))
    )
    this.timer.unref?.()
  }

  private async drain(): Promise<void> {
    for (const group of [...this.groups]) {
      if (this.closed || group.dueAt === null || group.dueAt > this.now()) continue
      try {
        // A failed Done save or an undo must also protect inherited processes.
        const reopened: string[] = []
        for (const target of group.pending) {
          if (!(await this.dependencies.metadata(target.id)).done) reopened.push(target.id)
        }
        if (reopened.length) {
          group.pending = group.pending.filter((target) => !reopened.includes(target.id))
          group.holders.push(...reopened)
          group.dueAt = null
          if (!group.pending.length)
            this.groups = this.groups.filter((candidate) => candidate !== group)
          continue
        }
        for (const target of [...group.pending]) {
          if (this.closed) return
          await this.dependencies.cleanup([target.id], target.providerId)
          group.pending = group.pending.filter((chat) => chat !== target)
        }
        this.groups = this.groups.filter((candidate) => candidate !== group)
      } catch (error) {
        group.dueAt = this.now() + chatProcessCleanupDelayMs
        this.dependencies.onError(error)
      }
    }
    await this.save()
  }
}
