import { sql } from 'kysely'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderChat, ProviderChatMetadata, ProviderChatPurpose } from '../../shared/provider'
import { isProviderChatPurpose } from '../../shared/provider'
import { isContainerTool, normalizeContainerTarget } from '../containerTarget'
import { getDatabase } from './sqlite'
import { DatabaseReadCache } from './readCache'

const metadataCache = new DatabaseReadCache<ProviderChatMetadata>()

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
  noProject: false,
  pinned: false,
  sidebarOrder: null,
  done: false,
  doneAt: null,
  seenUpdatedAt: null,
  purpose: null,
  container: null
})

const mapContainerTarget = (
  tool: string | null,
  name: string | null,
  runtimeTool: string | null,
  runtimeName: string | null
): AppContainerTarget | null => {
  if (!isContainerTool(tool) || !name?.trim()) return null
  if (tool !== 'ssh') return { kind: 'container', tool, name: name.trim() }

  const runtime =
    isContainerTool(runtimeTool) && runtimeTool !== 'ssh' && runtimeName?.trim()
      ? ({ kind: 'container', tool: runtimeTool, name: runtimeName.trim() } as const)
      : ({ kind: 'host' } as const)

  return { kind: 'container', tool: 'ssh', name: name.trim(), runtime }
}

const mapChatMetadataRow = (row: {
  account_id: string | null
  container_name: string | null
  container_runtime_name: string | null
  container_runtime_tool: string | null
  container_tool: string | null
  id: string
  no_project: number
  pinned: number
  pinned_order: number | null
  done: number
  done_at: number | null
  seen_updated_at: number | null
  purpose: ProviderChatPurpose | null
}): ProviderChatMetadata => ({
  id: row.id,
  accountId: row.account_id,
  noProject: toBoolean(row.no_project),
  pinned: toBoolean(row.pinned),
  sidebarOrder: toNumberOrNull(row.pinned_order),
  done: toBoolean(row.done),
  doneAt: toNumberOrNull(row.done_at),
  seenUpdatedAt: toNumberOrNull(row.seen_updated_at),
  purpose: isProviderChatPurpose(row.purpose) ? row.purpose : null,
  container: mapContainerTarget(
    row.container_tool,
    row.container_name,
    row.container_runtime_tool,
    row.container_runtime_name
  )
})

const uniqueChatIds = (chatIds: string[]): string[] =>
  Array.from(new Set(chatIds.map((chatId) => chatId.trim()).filter(Boolean)))

export const getChatMetadata = async (chatId: string): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  return metadataCache.read(db, chatId, async () => {
    const row = await db
      .selectFrom('chat')
      .select([
        'id',
        'account_id',
        'container_tool',
        'container_name',
        'container_runtime_tool',
        'container_runtime_name',
        'no_project',
        'pinned',
        'pinned_order',
        'done',
        'done_at',
        'seen_updated_at',
        'purpose'
      ])
      .where('id', '=', chatId)
      .executeTakeFirst()

    return row ? mapChatMetadataRow(row) : getDefaultChatMetadata(chatId)
  })
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
        'account_id',
        'container_tool',
        'container_name',
        'container_runtime_tool',
        'container_runtime_name',
        'no_project',
        'pinned',
        'pinned_order',
        'done',
        'done_at',
        'seen_updated_at',
        'purpose'
      ])
      .where('id', 'in', chunk)
      .execute()

    rows.forEach((row) => metadataById.set(row.id, mapChatMetadataRow(row)))
  }

  return metadataById
}

export const getChatContainers = async (): Promise<AppContainerTarget[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('chat')
    .select([
      'container_tool',
      'container_name',
      'container_runtime_tool',
      'container_runtime_name'
    ])
    .distinct()
    .execute()

  return rows.flatMap((row) => {
    const container = mapContainerTarget(
      row.container_tool,
      row.container_name,
      row.container_runtime_tool,
      row.container_runtime_name
    )
    return container ? [container] : []
  })
}

export const setChatNoProject = async (chatId: string): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, done: 0, no_project: 1 })
    .onConflict((conflict) => conflict.column('id').doUpdateSet({ no_project: 1 }))
    .execute()
  metadataCache.invalidate(chatId)
  return getChatMetadata(chatId)
}

export const setChatDone = async (chatId: string, done = true): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  const doneValue = done ? 1 : 0
  const doneAt = done ? Date.now() : null

  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, pinned_order: null, done: doneValue, done_at: doneAt })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        done: doneValue,
        done_at: doneAt,
        pinned_order: null
      })
    )
    .execute()

  metadataCache.invalidate(chatId)
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
    .values({ id: chatId, pinned: pinnedValue, pinned_order: null, done: 0 })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        pinned: pinnedValue,
        pinned_order: null
      })
    )
    .execute()

  metadataCache.invalidate(chatId)
  return getChatMetadata(chatId)
}

export const setChatOrder = async (chatIds: string[]): Promise<ProviderChatMetadata[]> => {
  const ids = uniqueChatIds(chatIds)
  if (ids.length === 0) return []

  const db = await getDatabase()
  await db.transaction().execute(async (transaction) => {
    for (const [sidebarOrder, id] of ids.entries()) {
      await transaction
        .insertInto('chat')
        .values({ id, pinned: 0, pinned_order: sidebarOrder, done: 0 })
        .onConflict((conflict) => conflict.column('id').doUpdateSet({ pinned_order: sidebarOrder }))
        .execute()
    }
  })

  ids.forEach((id) => metadataCache.invalidate(id))
  const metadataById = await getChatMetadataByIds(ids)
  return ids.map((id) => metadataById.get(id) ?? getDefaultChatMetadata(id))
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

  metadataCache.invalidate(chatId)
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

  metadataCache.invalidate(chatId)
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
  const containerRuntime =
    normalizedContainer.kind === 'container' &&
    normalizedContainer.tool === 'ssh' &&
    normalizedContainer.runtime?.kind === 'container'
      ? normalizedContainer.runtime
      : null

  await db
    .insertInto('chat')
    .values({
      id: chatId,
      pinned: 0,
      done: 0,
      container_tool: containerTool,
      container_name: containerName,
      container_runtime_tool: containerRuntime?.tool ?? null,
      container_runtime_name: containerRuntime?.name ?? null
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        container_tool: containerTool,
        container_name: containerName,
        container_runtime_tool: containerRuntime?.tool ?? null,
        container_runtime_name: containerRuntime?.name ?? null
      })
    )
    .execute()

  metadataCache.invalidate(chatId)
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
  const doneAt = done ? Date.now() : null

  for (let index = 0; index < ids.length; index += chatMetadataChunkSize) {
    const chunk = ids.slice(index, index + chatMetadataChunkSize)

    await db
      .insertInto('chat')
      .values(
        chunk.map((id) => ({ id, pinned: 0, pinned_order: null, done: doneValue, done_at: doneAt }))
      )
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({
          done: doneValue,
          done_at: doneAt,
          pinned_order: null
        })
      )
      .execute()
    chunk.forEach((id) => metadataCache.invalidate(id))
  }

  ids.forEach((id) => metadataCache.invalidate(id))
  const metadataById = await getChatMetadataByIds(ids)
  return ids.map((id) => metadataById.get(id) ?? getDefaultChatMetadata(id))
}

/** Bind only once unless the user explicitly changes this chat's account. */
export const setChatAccount = async (
  chatId: string,
  accountId: string,
  replace = false
): Promise<string> => {
  const db = await getDatabase()
  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, done: 0, account_id: accountId })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        account_id: replace ? accountId : sql<string>`coalesce(chat.account_id, ${accountId})`
      })
    )
    .execute()
  metadataCache.invalidate(chatId)
  return (await getChatMetadata(chatId)).accountId!
}

export const bindChatAccounts = async (
  chats: Pick<ProviderChat, 'id' | 'container'>[],
  accountId: string
): Promise<Map<string, ProviderChatMetadata>> => {
  const ids = uniqueChatIds(chats.map((chat) => chat.id))
  const byId = new Map(chats.map((chat) => [chat.id, chat]))
  const existing = await getChatMetadataByIds(ids)
  const unbound = ids.filter(
    (id) =>
      !existing.get(id)?.accountId ||
      (!existing.get(id)?.container && byId.get(id)?.container?.kind === 'container')
  )
  if (!unbound.length) return existing
  const db = await getDatabase()
  for (let index = 0; index < unbound.length; index += chatMetadataChunkSize) {
    await db
      .insertInto('chat')
      .values(
        unbound.slice(index, index + chatMetadataChunkSize).map((id) => {
          const target = normalizeContainerTarget(byId.get(id)?.container)
          const container = target.kind === 'container' ? target : null
          const runtime =
            container?.tool === 'ssh' && container.runtime?.kind === 'container'
              ? container.runtime
              : null
          return {
            id,
            pinned: 0,
            done: 0,
            account_id: accountId,
            container_tool: container?.tool ?? null,
            container_name: container?.name ?? null,
            container_runtime_tool: runtime?.tool ?? null,
            container_runtime_name: runtime?.name ?? null
          }
        })
      )
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({
          account_id: sql<string>`coalesce(chat.account_id, ${accountId})`,
          container_tool: sql<string>`coalesce(chat.container_tool, excluded.container_tool)`,
          container_name: sql<string>`coalesce(chat.container_name, excluded.container_name)`,
          container_runtime_tool: sql<string>`coalesce(chat.container_runtime_tool, excluded.container_runtime_tool)`,
          container_runtime_name: sql<string>`coalesce(chat.container_runtime_name, excluded.container_runtime_name)`
        })
      )
      .execute()
  }
  unbound.forEach((id) => metadataCache.invalidate(id))
  return getChatMetadataByIds(ids)
}
