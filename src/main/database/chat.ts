import { sql } from 'kysely'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderChatMetadata, ProviderChatPurpose } from '../../shared/provider'
import { isContainerTool, normalizeContainerTarget } from '../containerTarget'
import { getDatabase } from './sqlite'

const chatMetadataChunkSize = 200

const toBoolean = (value: unknown): boolean => value === true || value === 1
const toNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const normalizeSeenUpdatedAt = (seenUpdatedAt: number): number => {
  if (!Number.isFinite(seenUpdatedAt) || seenUpdatedAt < 0) {
    throw new Error('Invalid seen timestamp')
  }

  return Math.floor(seenUpdatedAt)
}

const getDefaultChatMetadata = (id: string): ProviderChatMetadata => ({
  id,
  pinned: false,
  done: false,
  seenUpdatedAt: null,
  purpose: null,
  container: null
})

const mapContainerTarget = (tool: string | null, name: string | null): AppContainerTarget | null =>
  isContainerTool(tool) && name?.trim() ? { kind: 'container', tool, name: name.trim() } : null

const mapChatMetadataRow = (row: {
  container_name: string | null
  container_tool: string | null
  id: string
  pinned: number
  done: number
  seen_updated_at: number | null
  purpose: ProviderChatPurpose | null
}): ProviderChatMetadata => ({
  id: row.id,
  pinned: toBoolean(row.pinned),
  done: toBoolean(row.done),
  seenUpdatedAt: toNumberOrNull(row.seen_updated_at),
  purpose: row.purpose === 'commit' ? row.purpose : null,
  container: mapContainerTarget(row.container_tool, row.container_name)
})

const uniqueChatIds = (chatIds: string[]): string[] =>
  Array.from(new Set(chatIds.map((chatId) => chatId.trim()).filter(Boolean)))

export const getChatMetadata = async (chatId: string): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  const row = await db
    .selectFrom('chat')
    .select([
      'id',
      'container_tool',
      'container_name',
      'pinned',
      'done',
      'seen_updated_at',
      'purpose'
    ])
    .where('id', '=', chatId)
    .executeTakeFirst()

  return row ? mapChatMetadataRow(row) : getDefaultChatMetadata(chatId)
}

export const getChatMetadataByIds = async (
  chatIds: string[]
): Promise<Map<string, ProviderChatMetadata>> => {
  const ids = uniqueChatIds(chatIds)
  const metadataById = new Map(ids.map((id) => [id, getDefaultChatMetadata(id)]))
  if (ids.length === 0) return metadataById

  const db = await getDatabase()

  for (let index = 0; index < ids.length; index += chatMetadataChunkSize) {
    const chunk = ids.slice(index, index + chatMetadataChunkSize)
    const rows = await db
      .selectFrom('chat')
      .select([
        'id',
        'container_tool',
        'container_name',
        'pinned',
        'done',
        'seen_updated_at',
        'purpose'
      ])
      .where('id', 'in', chunk)
      .execute()

    rows.forEach((row) => metadataById.set(row.id, mapChatMetadataRow(row)))
  }

  return metadataById
}

export const setChatDone = async (chatId: string, done = true): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  const doneValue = done ? 1 : 0

  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, done: doneValue })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        done: doneValue
      })
    )
    .execute()

  return getChatMetadata(chatId)
}

export const setChatPinned = async (
  chatId: string,
  pinned: boolean
): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  const pinnedValue = pinned ? 1 : 0

  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: pinnedValue, done: 0 })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        pinned: pinnedValue
      })
    )
    .execute()

  return getChatMetadata(chatId)
}

export const setChatSeen = async (
  chatId: string,
  seenUpdatedAt: number
): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  const nextSeenUpdatedAt = normalizeSeenUpdatedAt(seenUpdatedAt)

  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, done: 0, seen_updated_at: nextSeenUpdatedAt })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        seen_updated_at: sql<number>`max(coalesce(seen_updated_at, 0), ${nextSeenUpdatedAt})`
      })
    )
    .execute()

  return getChatMetadata(chatId)
}

export const setChatPurpose = async (
  chatId: string,
  purpose: ProviderChatPurpose
): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()

  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, done: 0, purpose })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        purpose
      })
    )
    .execute()

  return getChatMetadata(chatId)
}

export const setChatContainer = async (
  chatId: string,
  container: AppContainerTarget | null | undefined
): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  const normalizedContainer = normalizeContainerTarget(container)
  const containerTool = normalizedContainer.kind === 'container' ? normalizedContainer.tool : null
  const containerName = normalizedContainer.kind === 'container' ? normalizedContainer.name : null

  await db
    .insertInto('chat')
    .values({
      id: chatId,
      pinned: 0,
      done: 0,
      container_tool: containerTool,
      container_name: containerName
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        container_tool: containerTool,
        container_name: containerName
      })
    )
    .execute()

  return getChatMetadata(chatId)
}

export const setChatsDone = async (
  chatIds: string[],
  done = true
): Promise<ProviderChatMetadata[]> => {
  const ids = uniqueChatIds(chatIds)
  if (ids.length === 0) return []

  const db = await getDatabase()
  const doneValue = done ? 1 : 0

  for (let index = 0; index < ids.length; index += chatMetadataChunkSize) {
    const chunk = ids.slice(index, index + chatMetadataChunkSize)

    await db
      .insertInto('chat')
      .values(chunk.map((id) => ({ id, pinned: 0, done: doneValue })))
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({
          done: doneValue
        })
      )
      .execute()
  }

  const metadataById = await getChatMetadataByIds(ids)
  return ids.map((id) => metadataById.get(id) ?? getDefaultChatMetadata(id))
}
