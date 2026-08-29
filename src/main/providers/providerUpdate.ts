import type {
  ProviderChat,
  ProviderSourceOptions,
  ProviderUpdateImpact
} from '../../shared/provider'
import type { ProviderAdapter } from './ProviderAdapter'

type ProviderUpdateAdapter = Pick<ProviderAdapter, 'getChats' | 'stopChat'>

const activeChatStatuses = new Set<NonNullable<ProviderChat['status']>>([
  'active',
  'waitingOnApproval',
  'waitingOnUserInput'
])

export const collectActiveProviderChats = async (
  adapter: ProviderUpdateAdapter,
  options: ProviderSourceOptions = {}
): Promise<ProviderChat[]> => {
  const activeChats = new Map<string, ProviderChat>()
  const visitedCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const page = await adapter.getChats({
      ...options,
      cursor,
      limit: 100
    })

    page.chats.forEach((chat) => {
      if (chat.status && activeChatStatuses.has(chat.status)) activeChats.set(chat.id, chat)
    })

    const nextCursor = page.nextCursor
    if (!nextCursor || visitedCursors.has(nextCursor)) break
    visitedCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)

  return Array.from(activeChats.values())
}

export const getProviderUpdateImpact = async (
  adapter: ProviderUpdateAdapter,
  options: ProviderSourceOptions = {}
): Promise<ProviderUpdateImpact> => ({
  activeChatCount: (await collectActiveProviderChats(adapter, options)).length
})

export const stopActiveProviderChats = async (
  adapter: ProviderUpdateAdapter,
  chats: readonly ProviderChat[]
): Promise<void> => {
  const results = await Promise.allSettled(chats.map((chat) => adapter.stopChat(chat.id)))
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length === 0) return

  const firstFailure = failures[0].reason
  const detail = firstFailure instanceof Error ? firstFailure.message : String(firstFailure)
  throw new Error(
    `Unable to stop ${failures.length} of ${chats.length} active chats before updating: ${detail}`
  )
}
