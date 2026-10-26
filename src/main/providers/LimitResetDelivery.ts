import type { ProviderStartChatOptions } from '../../shared/provider'
import {
  bindLimitResetDraftChat,
  type LimitResetBackend,
  type LimitResetEntry
} from './LimitResetQueue.ts'

type Dependencies = {
  backend: LimitResetBackend
  prepare: (entry: LimitResetEntry) => Promise<ProviderStartChatOptions>
  create: (entry: LimitResetEntry, onCreated: (id: string) => Promise<void>) => Promise<unknown>
  saveMetadata: (entry: LimitResetEntry) => Promise<void>
  enqueue: (entry: LimitResetEntry & { chatId: string }) => Promise<void>
}

/** Called only after the saved reset deadline. Identity is persisted before any prompt starts. */
export const createLimitResetDelivery =
  (dependencies: Dependencies) =>
  async (entry: LimitResetEntry): Promise<void> => {
    if (!entry.chatId) {
      const sibling = (await dependencies.backend.list()).find(
        (other) =>
          other.chatId &&
          other.providerId === entry.providerId &&
          other.draftKey === entry.draftKey &&
          other.accountId === entry.accountId
      )
      if (sibling?.chatId) {
        await bindLimitResetDraftChat(dependencies.backend, entry, sibling.chatId, sibling.options)
      } else {
        if (!entry.workspacePrepared) {
          entry.options = { ...(await dependencies.prepare(entry)), deferInitialMessage: true }
          entry.workspacePrepared = true
          await dependencies.backend.put(entry)
        }
        await dependencies.create(entry, (id) =>
          bindLimitResetDraftChat(dependencies.backend, entry, id, entry.options)
        )
      }
    }
    if (!entry.chatId) throw new Error('Unable to create the scheduled chat.')
    await dependencies.saveMetadata(entry)
    await dependencies.enqueue({ ...entry, chatId: entry.chatId })
  }
