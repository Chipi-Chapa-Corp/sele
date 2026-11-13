import { sql, type Insertable, type Selectable } from 'kysely'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderChat, ProviderChatMetadata, ProviderChatPurpose } from '../../shared/provider'
import { isProviderChatPurpose } from '../../shared/provider'
import { isContainerTool, normalizeContainerTarget } from '../containerTarget'
import { getDatabase, type LocalDatabase } from './sqlite'
import { DatabaseReadCache } from './readCache'
import { publishChatMetadataChanged } from '../providers/chatMetadataEvents'

const metadataCache = new DatabaseReadCache<ProviderChatMetadata>()

const chatMetadataChunkSize = 200
const chatMetadataColumns = [
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
] as const

type ChatRow = Selectable<LocalDatabase['chat']>

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

const mapContainerTarget = ({
  container_tool: tool,
  container_name: name,
  container_runtime_tool: runtimeTool,
  container_runtime_name: runtimeName
}: Pick<
  ChatRow,
  'container_tool' | 'container_name' | 'container_runtime_tool' | 'container_runtime_name'
>): AppContainerTarget | null => {
  if (!isContainerTool(tool) || !name?.trim()) return null
  if (tool !== 'ssh') return { kind: 'container', tool, name: name.trim() }

  const runtime =
    isContainerTool(runtimeTool) && runtimeTool !== 'ssh' && runtimeName?.trim()
      ? ({ kind: 'container', tool: runtimeTool, name: runtimeName.trim() } as const)
      : ({ kind: 'host' } as const)

  return { kind: 'container', tool: 'ssh', name: name.trim(), runtime }
}

const mapChatMetadataRow = (row: ChatRow): ProviderChatMetadata => ({
  id: row.id,
  accountId: row.account_id,
  noProject: toBoolean(row.no_project),
  pinned: toBoolean(row.pinned),
  sidebarOrder: toNumberOrNull(row.pinned_order),
  done: toBoolean(row.done),
  doneAt: toNumberOrNull(row.done_at),
  seenUpdatedAt: toNumberOrNull(row.seen_updated_at),
  purpose: isProviderChatPurpose(row.purpose) ? row.purpose : null,
  container: mapContainerTarget(row)
})

const uniqueChatIds = (chatIds: string[]): string[] =>
  Array.from(new Set(chatIds.map((chatId) => chatId.trim()).filter(Boolean)))

export const getChatMetadata = async (chatId: string): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  return metadataCache.read(db, chatId, async () => {
    const row = await db
      .selectFrom('chat')
      .select(chatMetadataColumns)
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
      .select(chatMetadataColumns)
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
    const container = mapContainerTarget(row)
    return container ? [container] : []
  })
}

const getChangedChatMetadata = async (chatId: string): Promise<ProviderChatMetadata> => {
  metadataCache.invalidate(chatId)
  const metadata = await getChatMetadata(chatId)
  publishChatMetadataChanged([metadata])
  return metadata
}

const saveChatColumns = async (
  chatId: string,
  columns: Omit<Insertable<LocalDatabase['chat']>, 'id'>
): Promise<ProviderChatMetadata> => {
  const db = await getDatabase()
  await db
    .insertInto('chat')
    .values({ id: chatId, pinned: 0, done: 0, ...columns })
    .onConflict((conflict) => conflict.column('id').doUpdateSet(columns))
    .execute()
  return getChangedChatMetadata(chatId)
}

const getContainerColumns = (target: AppContainerTarget | null | undefined) => {
  const container = normalizeContainerTarget(target)
  const runtime =
    container.kind === 'container' &&
    container.tool === 'ssh' &&
    container.runtime?.kind === 'container'
      ? container.runtime
      : null
  return {
    container_tool: container.kind === 'container' ? container.tool : null,
    container_name: container.kind === 'container' ? container.name : null,
    container_runtime_tool: runtime?.tool ?? null,
    container_runtime_name: runtime?.name ?? null
  }
}

export const setChatNoProject = (chatId: string): Promise<ProviderChatMetadata> =>
  saveChatColumns(chatId, { no_project: 1 })

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

  return getChangedChatMetadata(chatId)
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

  return getChangedChatMetadata(chatId)
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
  const metadata = [...(await getChatMetadataByIds(ids)).values()]
  publishChatMetadataChanged(metadata)
  return metadata
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
      conflict
        .column('id')
        .doUpdateSet({
          seen_updated_at: sql<number>`max(coalesce(seen_updated_at, 0), ${nextSeenUpdatedAt})`
        })
        .where((eb) =>
          eb.or([eb('seen_updated_at', '<', nextSeenUpdatedAt), eb('seen_updated_at', 'is', null)])
        )
    )
    .execute()

  return getChangedChatMetadata(chatId)
}

export const setChatPurpose = (
  chatId: string,
  purpose: ProviderChatPurpose
): Promise<ProviderChatMetadata> => saveChatColumns(chatId, { purpose })

export const setChatContainer = (
  chatId: string,
  container: AppContainerTarget | null | undefined
): Promise<ProviderChatMetadata> => saveChatColumns(chatId, getContainerColumns(container))

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
  const metadata = [...(await getChatMetadataByIds(ids)).values()]
  publishChatMetadataChanged(metadata)
  return metadata
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
        unbound.slice(index, index + chatMetadataChunkSize).map((id) => ({
          id,
          pinned: 0,
          done: 0,
          account_id: accountId,
          ...getContainerColumns(byId.get(id)?.container)
        }))
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
  const metadata = await getChatMetadataByIds(ids)
  publishChatMetadataChanged([...metadata.values()])
  return metadata
}
