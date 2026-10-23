import type { ProviderId, ProviderPendingMessageKind } from '../../shared/provider'

export type PendingMessageRow = {
  id: string
  kind: ProviderPendingMessageKind
  /** Handed to the provider, which has not confirmed it yet. */
  submitted: boolean
  createdAt: number
  payload: string
}

export type PendingMessageBackend = {
  replace: (providerId: ProviderId, chatId: string, rows: PendingMessageRow[]) => Promise<void>
  read: (providerId: ProviderId, chatId: string) => Promise<PendingMessageRow[]>
}

export type PersistedPendingMessage<Payload> = {
  id: string
  kind: ProviderPendingMessageKind
  submitted: boolean
  createdAt: number
  payload: Payload
}

type SavedSnapshot = {
  entries: { id: string; kind: string; submitted: boolean; payload: unknown }[]
}

const stores = new Set<PersistentPendingMessages<unknown>>()

/** Waits for every provider's queued and steering message writes. */
export const flushPersistentPendingMessages = async (): Promise<void> => {
  await Promise.all([...stores].map((store) => store.flush()))
}

/**
 * Mirrors each chat's undelivered messages (queued, and steering not yet confirmed by the
 * provider) so they survive a restart. Adapters save their live list after every change and
 * restore it once per chat when that chat's state is first built.
 */
export class PersistentPendingMessages<Payload> {
  private readonly tracked = new Set<string>()
  private readonly restoring = new Map<string, Promise<PersistedPendingMessage<Payload>[]>>()
  private readonly saved = new Map<string, SavedSnapshot>()
  private readonly pending = new Map<string, PendingMessageRow[]>()
  private writing: Promise<void> = Promise.resolve()
  private draining = false
  private closed = false
  private readonly providerId: ProviderId
  private readonly backend: PendingMessageBackend

  constructor(providerId: ProviderId, backend: PendingMessageBackend) {
    this.providerId = providerId
    this.backend = backend
    stores.add(this as PersistentPendingMessages<unknown>)
  }

  /** A chat created in this process has nothing stored; its later changes are saved. */
  track = (chatId: string): void => {
    if (!this.closed) this.tracked.add(chatId)
  }

  /**
   * Returns the stored messages the first time a chat is loaded in this process, and an empty
   * list afterwards: from then on the adapter's live state is authoritative.
   */
  restore = (chatId: string): Promise<PersistedPendingMessage<Payload>[]> => {
    if (this.closed || this.tracked.has(chatId)) return Promise.resolve([])
    const existing = this.restoring.get(chatId)
    if (existing) return existing.then(() => [])
    const restoring = this.backend
      .read(this.providerId, chatId)
      .then((rows) =>
        rows.flatMap((row): PersistedPendingMessage<Payload>[] => {
          try {
            return [{ ...row, payload: JSON.parse(row.payload) as Payload }]
          } catch (error) {
            console.error(`Unable to restore a pending ${this.providerId} message.`, error)
            return []
          }
        })
      )
      .catch((error: unknown) => {
        console.error(`Unable to restore pending ${this.providerId} messages for ${chatId}.`, error)
        return []
      })
      .then((messages) => {
        // Whatever the adapter keeps of these is saved again, so dropping all of them still
        // reaches storage.
        this.saved.set(chatId, {
          entries: messages.map(({ id, kind, submitted, payload }) => ({
            id,
            kind,
            submitted,
            payload
          }))
        })
        return messages
      })
      .finally(() => {
        this.restoring.delete(chatId)
        if (!this.closed) this.tracked.add(chatId)
      })
    this.restoring.set(chatId, restoring)
    return restoring
  }

  /** Records the chat's complete current list. Unchanged lists are not rewritten. */
  save = (chatId: string, messages: readonly PersistedPendingMessage<Payload>[]): void => {
    if (this.closed || !this.tracked.has(chatId)) return
    const previous = this.saved.get(chatId)
    if (
      previous
        ? previous.entries.length === messages.length &&
          previous.entries.every((entry, index) => {
            const message = messages[index]!
            return (
              entry.id === message.id &&
              entry.kind === message.kind &&
              entry.submitted === message.submitted &&
              entry.payload === message.payload
            )
          })
        : messages.length === 0
    ) {
      this.saved.set(chatId, previous ?? { entries: [] })
      return
    }
    this.saved.set(chatId, {
      entries: messages.map(({ id, kind, submitted, payload }) => ({
        id,
        kind,
        submitted,
        payload
      }))
    })
    this.pending.set(
      chatId,
      messages.map((message) => ({
        id: message.id,
        kind: message.kind,
        submitted: message.submitted,
        createdAt: message.createdAt,
        payload: JSON.stringify(message.payload)
      }))
    )
    this.scheduleWrite()
  }

  /** The adapter changed a message in place; the next save rewrites the chat's list. */
  invalidate = (chatId: string): void => {
    if (this.saved.has(chatId)) this.saved.set(chatId, { entries: [] })
  }

  flush = async (): Promise<void> => {
    while (this.draining || this.pending.size > 0) {
      if (!this.draining) this.scheduleWrite()
      await this.writing
    }
  }

  /** Stops recording: shutdown must not save queues the adapter is tearing down. */
  close = (): Promise<void> => {
    this.closed = true
    return this.flush()
  }

  private scheduleWrite = (): void => {
    if (this.draining) return
    this.draining = true
    this.writing = (async () => {
      // Coalesce the saves made by one synchronous mutation burst.
      await Promise.resolve()
      try {
        for (const [chatId, rows] of this.pending) {
          this.pending.delete(chatId)
          try {
            await this.backend.replace(this.providerId, chatId, rows)
          } catch (error) {
            // Forget the snapshot so the next change retries the whole list.
            this.saved.delete(chatId)
            console.error(
              `Unable to save pending ${this.providerId} messages for ${chatId}.`,
              error
            )
          }
        }
      } finally {
        this.draining = false
      }
    })()
  }
}
