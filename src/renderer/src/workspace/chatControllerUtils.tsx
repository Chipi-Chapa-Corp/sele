import type { AppProject, AppSelectedAttachment } from '../../../shared/app'
import { isNoProjectChat, isNoProjectCwd, noProjectGroupKey } from '../../../shared/noProject'

import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatDetailUpdate,
  ProviderChatUpdateSummary,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool,
  ProviderChatItem,
  ProviderMessage,
  ProviderId,
  ProviderModel,
  ProviderToolActivity,
  ProviderToolIcon,
  ProviderAccountUsage,
  ProviderReasoningEffort,
  ProviderServiceTier,
  ProviderReview,
  ProviderReviewComment,
  ProviderAppInput,
  ProviderSkillInput
} from '../../../shared/provider'

import { getProviderChatTurns } from '../../../shared/chatTurns'
import { markChatItemsChanged } from '../chatConversationModel'
import { reuseChatSnapshotItems } from '../chatSnapshotItems'
import { mergeSeenUpdatedAt } from '../chatMetadata'

import { type ChatListGroupData } from '../components/ChatListGroup'

import type { ChatPlanData, ChatPlanItem } from '../components/ChatPlan'

import {
  sortChatsForSidebarSection,
  sortDoneChats,
  sortProjectGroupsForSidebar
} from '../chatSidebarOrder'

import { type AppGitCommitPromptSettings, type AppGitWorktreeSettings } from '../settings'

import { type ChangeSource, type GitChangeSource } from '../changeTree'

import { getContainerTargetKey } from '../containerSelection'

import { type ChatCommitMarker } from '../components/AppStatusStates'

import { type CommitActivityAction } from '../chatCommitStorage'

import {
  hasProviderUserMessageAfterOptimisticTurn,
  optimisticChatItemIdPrefix,
  refreshRetainedChatDetailTurnWindow
} from '../chatDetailWindow'

import {
  changeSourceLabels,
  commitActionLabels,
  doneGroupKey,
  pinnedGroupKey,
  unknownCwdGroupKey,
  type FileTreeScope,
  type GitCommitPromptAction,
  type GitChangesScope,
  type RecentChatCacheEntry
} from './controllerTypes'

export const modelSupportsReasoningEffort = (
  model: ProviderModel | undefined,
  reasoningEffort: ProviderReasoningEffort | undefined
): boolean =>
  reasoningEffort != null &&
  (!model || model.supportedReasoningEfforts.some((option) => option.id === reasoningEffort))

export const modelSupportsServiceTier = (
  model: ProviderModel | undefined,
  serviceTier: ProviderServiceTier | null
): boolean =>
  serviceTier == null ||
  !model ||
  Boolean(model.supportedServiceTiers?.some((option) => option.id === serviceTier))

export const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

export const getProviderChatKey = (providerId: ProviderId, chatId: string): string =>
  getChatKey({ providerId, id: chatId })

export const createChatCommitMarkerId = (): string =>
  `ai-commit:${Date.now()}:${crypto.randomUUID()}`

export const trimRecentChatCache = (
  cache: Map<string, RecentChatCacheEntry>,
  limit: number
): void => {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value
    if (typeof oldestKey !== 'string') return
    cache.delete(oldestKey)
  }
}

export const isActiveChatStatus = (status: ProviderChatDetail['status'] | undefined): boolean =>
  status === 'active' || status === 'waitingOnApproval' || status === 'waitingOnUserInput'

export const getLastChatCommitMarkerAnchorId = (
  items: ProviderChatItem[],
  fallbackId: string | null = null
): string | null => items.findLast((item) => item.type !== 'pendingMessage')?.id ?? fallbackId

export const getChatItemCreatedAt = (item: ProviderChatItem): number | null =>
  (item.type === 'message' || item.type === 'pendingMessage') &&
  typeof item.createdAt === 'number' &&
  Number.isFinite(item.createdAt)
    ? item.createdAt
    : null

export const getChatCommitMarkerPlacementTime = (marker: ChatCommitMarker): number =>
  marker.finishedAt ?? marker.startedAt

export const compareChatsByCreatedAtDesc = (
  firstChat: ProviderChat,
  secondChat: ProviderChat
): number => {
  if (secondChat.createdAt !== firstChat.createdAt) {
    return secondChat.createdAt - firstChat.createdAt
  }

  return secondChat.updatedAt - firstChat.updatedAt
}

export const mergeChats = (...chatGroups: ProviderChat[][]): ProviderChat[] => {
  const chatsById = new Map<string, ProviderChat>()

  for (const chatGroup of chatGroups) {
    for (const chat of chatGroup) {
      const chatKey = getChatKey(chat)
      const existingChat = chatsById.get(chatKey)

      if (!existingChat || chat.updatedAt >= existingChat.updatedAt) {
        chatsById.set(chatKey, chat)
      }
    }
  }

  return Array.from(chatsById.values()).sort(compareChatsByCreatedAtDesc)
}

export const compareProjectsByUpdatedAtDesc = (
  firstProject: AppProject,
  secondProject: AppProject
): number => {
  if (secondProject.updatedAt !== firstProject.updatedAt) {
    return secondProject.updatedAt - firstProject.updatedAt
  }

  return getFolderName(firstProject.cwd).localeCompare(getFolderName(secondProject.cwd))
}

export const mergeProjects = (...projectGroups: AppProject[][]): AppProject[] => {
  const projectsByCwd = new Map<string, AppProject>()

  for (const projectGroup of projectGroups) {
    for (const project of projectGroup) {
      const cwd = project.cwd.trim()
      if (!cwd) continue

      const normalizedProject = { ...project, cwd }
      const existingProject = projectsByCwd.get(cwd)
      if (!existingProject || project.updatedAt >= existingProject.updatedAt) {
        projectsByCwd.set(cwd, normalizedProject)
      }
    }
  }

  return Array.from(projectsByCwd.values()).sort(compareProjectsByUpdatedAtDesc)
}

export const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

export const getParentPath = (path: string): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const pathSeparatorIndex = normalizedPath.lastIndexOf('/')

  return pathSeparatorIndex < 0 ? '.' : normalizedPath.slice(0, pathSeparatorIndex)
}

export const getFolderName = (path: string | null): string =>
  isNoProjectCwd(path) ? 'No Project' : path ? getLastPathPart(path) : 'Choose folder'

export const getFolderDescription = (path: string): string => {
  const parentPath = getParentPath(path)

  return parentPath && parentPath !== '.' ? parentPath : path
}

export const getChatCwdLabel = (cwd: string | null): string =>
  isNoProjectCwd(cwd) ? 'No Project' : cwd?.trim() ? getLastPathPart(cwd.trim()) : 'Unknown cwd'

export const getChatCwdGroupKey = (cwd: string | null): string => {
  if (isNoProjectCwd(cwd)) return noProjectGroupKey
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? `cwd:${normalizedCwd}` : unknownCwdGroupKey
}

export const getChatProjectCwd = (
  chat: Pick<ProviderChat, 'cwd' | 'projectCwd' | 'noProject'>
): string | null =>
  isNoProjectChat(chat) ? null : chat.projectCwd?.trim() || chat.cwd?.trim() || null

export const getChatGroupKey = (
  chat: Pick<ProviderChat, 'cwd' | 'projectCwd' | 'noProject'>
): string =>
  isNoProjectChat(chat) ? noProjectGroupKey : getChatCwdGroupKey(getChatProjectCwd(chat))

export const getDefaultCollapsedGroupState = (groupKey: string): boolean =>
  groupKey === doneGroupKey

export const getCollapsedGroupState = (
  groupKey: string,
  collapsedGroups: Record<string, boolean>
): boolean => collapsedGroups[groupKey] ?? getDefaultCollapsedGroupState(groupKey)

export const sortChatsForGroup = (
  chats: ProviderChat[],
  previous?: ProviderChat[]
): ProviderChat[] => sortChatsForSidebarSection(chats, previous)

export const groupChatsForSidebar = (
  chats: ProviderChat[],
  projectsByCwd: ReadonlyMap<string, AppProject>,
  previous: ChatListGroupData[] = []
): ChatListGroupData[] => {
  const previousByKey = new Map(previous.map((group) => [group.key, group.chats]))
  const groupsByCwd = new Map<string, ChatListGroupData>()
  const pinnedChats: ProviderChat[] = []
  const doneChats: ProviderChat[] = []
  const importedChats: ProviderChat[] = []

  for (const chat of chats) {
    if (chat.imported) {
      ;(chat.done ? doneChats : importedChats).push(chat)
      continue
    }
    const projectCwd = getChatProjectCwd(chat)
    const key = getChatGroupKey(chat)

    if (chat.pinned) {
      pinnedChats.push(chat)
      continue
    }

    if (chat.done) {
      doneChats.push(chat)
      continue
    }

    const existingGroup = groupsByCwd.get(key)

    if (existingGroup) {
      existingGroup.chats.push(chat)
      continue
    }

    groupsByCwd.set(key, {
      key,
      cwd: key === noProjectGroupKey ? null : projectCwd,
      label: key === noProjectGroupKey ? 'Chats' : getChatCwdLabel(projectCwd),
      chats: [chat],
      kind: 'cwd'
    })
  }

  const cwdGroups = sortProjectGroupsForSidebar(
    Array.from(groupsByCwd.values()).map((group) => ({
      ...group,
      chats: sortChatsForGroup(group.chats, previousByKey.get(group.key))
    })),
    projectsByCwd
  )
  const pinnedGroups =
    pinnedChats.length === 0
      ? []
      : [
          {
            key: pinnedGroupKey,
            cwd: null,
            label: 'Pinned',
            chats: sortChatsForGroup(pinnedChats, previousByKey.get(pinnedGroupKey)),
            kind: 'pinned' as const
          }
        ]

  return [
    ...pinnedGroups,
    ...(importedChats.length
      ? [
          {
            key: 'imported',
            cwd: null,
            label: 'Imported',
            kind: 'imported' as const,
            chats: sortChatsForGroup(importedChats, previousByKey.get('imported'))
          }
        ]
      : []),
    ...cwdGroups,
    ...(doneChats.length === 0
      ? []
      : [
          {
            key: doneGroupKey,
            cwd: null,
            label: 'Done',
            chats: sortDoneChats(doneChats, previousByKey.get(doneGroupKey)),
            kind: 'done' as const
          }
        ])
  ]
}

export const getChatPreview = (detail: ProviderChatDetail): string | null => {
  const message = detail.items.findLast((item) => item.type === 'message')
  return message?.content.trim() || null
}

export const getChatFromDetail = (
  providerId: ProviderId,
  detail: ProviderChatDetail,
  existingChat: ProviderChat | null,
  updatedAt: number
): ProviderChat => ({
  id: detail.id,
  accountId: detail.accountId ?? existingChat?.accountId,
  noProject: detail.noProject ?? existingChat?.noProject,
  imported: detail.imported ?? existingChat?.imported,
  providerId,
  title: detail.title,
  preview: getChatPreview(detail) ?? existingChat?.preview ?? '',
  cwd: detail.cwd ?? existingChat?.cwd ?? null,
  cwdKind: detail.cwdKind ?? existingChat?.cwdKind ?? 'directory',
  projectCwd: detail.projectCwd ?? existingChat?.projectCwd ?? detail.cwd ?? null,
  branchName: detail.branchName ?? existingChat?.branchName ?? null,
  worktreeBaseBranchName:
    detail.worktreeBaseBranchName ?? existingChat?.worktreeBaseBranchName ?? null,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt ?? updatedAt,
  status:
    detail.pendingUserInput && detail.status !== 'waitingOnApproval'
      ? 'waitingOnUserInput'
      : detail.status,
  lastTurnOutcome:
    detail.lastTurnOutcome === undefined ? existingChat?.lastTurnOutcome : detail.lastTurnOutcome,
  pendingApproval: detail.pendingApproval,
  seenUpdatedAt: mergeSeenUpdatedAt(existingChat?.seenUpdatedAt, detail.seenUpdatedAt),
  pinned: detail.pinned ?? existingChat?.pinned ?? false,
  sidebarOrder: detail.sidebarOrder ?? existingChat?.sidebarOrder ?? null,
  done: detail.done ?? existingChat?.done ?? false,
  doneAt: detail.doneAt === undefined ? (existingChat?.doneAt ?? null) : detail.doneAt,
  purpose: detail.purpose ?? existingChat?.purpose ?? null,
  container: detail.container ?? existingChat?.container ?? null
})

export const areContainerTargetsEqual = (
  first: ProviderChat['container'],
  second: ProviderChat['container']
): boolean =>
  first === second ||
  ((!first || first.kind === 'host') && (!second || second.kind === 'host')) ||
  (first?.kind === 'container' &&
    second?.kind === 'container' &&
    first.tool === second.tool &&
    first.name === second.name &&
    (first.tool !== 'ssh' ||
      second.tool !== 'ssh' ||
      getContainerTargetKey(first) === getContainerTargetKey(second)))

export const isChatDetailSnapshotStale = (
  snapshot: Pick<ProviderChatDetail, 'id' | 'revision'>,
  currentDetail: ProviderChatDetail | null | undefined
): boolean => currentDetail?.id === snapshot.id && snapshot.revision <= currentDetail.revision

const retainLoadedChatItemPayload = (
  item: ProviderChatItem,
  currentItem: ProviderChatItem | undefined
): ProviderChatItem => {
  if (
    (item.type === 'message' || item.type === 'pendingMessage') &&
    item.contentLoaded === false &&
    currentItem?.type === item.type &&
    currentItem.contentLoaded !== false
  ) {
    return currentItem
  }

  if (
    item.type === 'working' &&
    item.itemsLoaded === false &&
    currentItem?.type === 'working' &&
    currentItem.itemsLoaded !== false
  ) {
    return {
      ...item,
      items: currentItem.items,
      itemsLoaded: true,
      itemCount: Math.max(item.itemCount ?? 0, currentItem.itemCount ?? 0),
      itemsStartIndex: currentItem.itemsStartIndex ?? 0,
      itemSegments: currentItem.itemSegments
    }
  }

  return item
}

/**
 * Applies authoritative provider structure within its loaded range. Cursor tail snapshots
 * can overlap a larger loaded viewport; retain only the prefix before that range.
 */
const resolveChatDetailSnapshot = (
  snapshot: ProviderChatDetail,
  currentDetail: ProviderChatDetail | null,
  options: {
    preserveCurrentTurnWindow?: boolean
    preserveOptimisticTurnUntilUserMessage?: boolean
  } = {}
): ProviderChatDetail => {
  const stableContainer =
    currentDetail?.id === snapshot.id &&
    areContainerTargetsEqual(currentDetail.container, snapshot.container)
      ? currentDetail.container
      : snapshot.container

  if (currentDetail?.id !== snapshot.id) return { ...snapshot, container: stableContainer }

  const viewingOlderCursorPage = Boolean(
    currentDetail.turnPagination?.kind === 'cursor' &&
      currentDetail.turnPagination.newerCursor &&
      snapshot.turnPagination?.kind === 'cursor' &&
      !snapshot.turnPagination.newerCursor
  )
  if (viewingOlderCursorPage) {
    const incomingTurns = new Map(
      getProviderChatTurns(snapshot.items).map((turn) => [turn.id, turn])
    )
    const currentItems = new Map(currentDetail.items.map((item) => [item.id, item]))
    const refreshedItems = getProviderChatTurns(currentDetail.items).flatMap((turn) => {
      const incoming = incomingTurns.get(turn.id)
      return incoming
        ? incoming.items.map((item) => retainLoadedChatItemPayload(item, currentItems.get(item.id)))
        : turn.items
    })
    const unchanged =
      refreshedItems.length === currentDetail.items.length &&
      refreshedItems.every((item, index) => item === currentDetail.items[index])
    return {
      ...snapshot,
      container: stableContainer,
      items: unchanged ? currentDetail.items : refreshedItems,
      subagents: currentDetail.subagents,
      itemsStartTurnIndex: currentDetail.itemsStartTurnIndex,
      turnCount: currentDetail.turnCount,
      turnPagination: currentDetail.turnPagination
    }
  }

  const currentItemsById = new Map(currentDetail.items.map((item) => [item.id, item]))
  let items = snapshot.items.map((item) =>
    retainLoadedChatItemPayload(item, currentItemsById.get(item.id))
  )

  if (
    options.preserveOptimisticTurnUntilUserMessage &&
    !hasProviderUserMessageAfterOptimisticTurn(currentDetail.items, items)
  ) {
    return {
      ...snapshot,
      container: stableContainer,
      items: currentDetail.items,
      itemsStartTurnIndex: currentDetail.itemsStartTurnIndex,
      turnCount: Math.max(currentDetail.turnCount ?? 0, snapshot.turnCount ?? 0)
    }
  }

  let turnPagination = snapshot.turnPagination
  let turnCount = snapshot.turnCount
  if (
    currentDetail.turnPagination &&
    !currentDetail.turnPagination.newerCursor &&
    snapshot.turnPagination?.olderCursor &&
    !snapshot.turnPagination.newerCursor
  ) {
    const incomingFirstTurn = getProviderChatTurns(items)[0]
    const prefixEnd = incomingFirstTurn
      ? currentDetail.items.findIndex((item) => item.id === incomingFirstTurn.id)
      : -1
    if (prefixEnd > 0) {
      // Keep already loaded history above the live page, but replace its entire
      // suffix so edits/reverts remove old replies and new turns always arrive.
      items = [...currentDetail.items.slice(0, prefixEnd), ...items]
      turnPagination = {
        ...snapshot.turnPagination,
        olderCursor: currentDetail.turnPagination.olderCursor
      }
      turnCount = getProviderChatTurns(items).length
    }
  }

  const nextDetail = { ...snapshot, container: stableContainer, items, turnPagination, turnCount }
  return options.preserveCurrentTurnWindow && !currentDetail.turnPagination
    ? refreshRetainedChatDetailTurnWindow(currentDetail, nextDetail)
    : nextDetail
}

export const getChatDetailFromSnapshot: typeof resolveChatDetailSnapshot = (
  snapshot,
  currentDetail,
  options
) =>
  reuseChatSnapshotItems(currentDetail, resolveChatDetailSnapshot(snapshot, currentDetail, options))

export type ChatDetailUpdateResult = {
  detail: ProviderChatDetail
  detailApplied: boolean
}

/**
 * Projects an exact ordered ID list over keyed entity payloads. There is no positional splice:
 * every output slot comes from one unique ID in `itemIds`, so duplication and reordering cannot
 * be introduced by delivery.
 */
export const getChatDetailFromUpdate = (
  update: ProviderChatDetailUpdate,
  currentDetail: ProviderChatDetail | null,
  options: {
    preserveCurrentTurnWindow?: boolean
    preserveOptimisticTurnUntilUserMessage?: boolean
  } = {}
): ChatDetailUpdateResult | null => {
  const { baseRevision, baseItemIds, itemIds, changedItems, ...metadata } = update
  const itemIdSet = new Set(itemIds)
  if (itemIdSet.size !== itemIds.length) return null
  if (baseRevision !== null || baseItemIds !== null) {
    if (
      baseRevision === null ||
      baseItemIds === null ||
      currentDetail?.id !== update.id ||
      currentDetail.revision !== baseRevision ||
      currentDetail.items.length !== baseItemIds.length ||
      currentDetail.items.some((item, index) => item.id !== baseItemIds[index])
    ) {
      return null
    }
  }

  const changedItemsById = new Map<string, ProviderChatItem>()
  for (const item of changedItems) {
    if (changedItemsById.has(item.id) || !itemIdSet.has(item.id)) return null
    changedItemsById.set(item.id, item)
  }

  const currentItemsById = new Map(
    currentDetail?.id === update.id
      ? currentDetail.items.map((item) => [item.id, item] as const)
      : []
  )
  const items: ProviderChatItem[] = []
  for (const itemId of itemIds) {
    const changedItem = changedItemsById.get(itemId)
    const currentItem = currentItemsById.get(itemId)
    const item = changedItem ? retainLoadedChatItemPayload(changedItem, currentItem) : currentItem
    if (!item) return null
    items.push(item)
  }

  const reconstructed = { ...metadata, items } satisfies ProviderChatDetail
  const detail = getChatDetailFromSnapshot(reconstructed, currentDetail, options)
  // A retained history window may merge live items without matching the delivered snapshot.
  // Only acknowledge that snapshot as a delta base when its entire ordered transcript is present.
  // An unchanged transcript can now reuse the previous array across an IPC copy.
  const detailApplied =
    detail.items.length === itemIds.length &&
    detail.items.every((item, index) => item.id === itemIds[index])

  if (detail.items !== currentDetail?.items) {
    const previousItems = currentDetail?.id === detail.id ? currentDetail.items : null
    let changedStartIndex = 0
    if (previousItems) {
      const sharedLength = Math.min(previousItems.length, detail.items.length)
      while (
        changedStartIndex < sharedLength &&
        previousItems[changedStartIndex] === detail.items[changedStartIndex]
      ) {
        changedStartIndex += 1
      }
    }
    markChatItemsChanged(detail.items, changedStartIndex, previousItems)
  }

  return { detail, detailApplied }
}

export const arePendingApprovalsEqual = (
  first: ProviderChat['pendingApproval'],
  second: ProviderChat['pendingApproval']
): boolean =>
  first === second ||
  (Boolean(first) &&
    Boolean(second) &&
    first?.id === second?.id &&
    first?.type === second?.type &&
    first?.command === second?.command &&
    first?.cwd === second?.cwd &&
    first?.reason === second?.reason &&
    first?.startedAt === second?.startedAt &&
    JSON.stringify(first?.permissionDetails) === JSON.stringify(second?.permissionDetails))

export const areChatsEqual = (first: ProviderChat, second: ProviderChat): boolean =>
  first.id === second.id &&
  first.providerId === second.providerId &&
  first.imported?.providerId === second.imported?.providerId &&
  first.imported?.chatId === second.imported?.chatId &&
  first.title === second.title &&
  first.preview === second.preview &&
  first.noProject === second.noProject &&
  first.cwd === second.cwd &&
  first.cwdKind === second.cwdKind &&
  first.projectCwd === second.projectCwd &&
  first.branchName === second.branchName &&
  first.worktreeBaseBranchName === second.worktreeBaseBranchName &&
  first.createdAt === second.createdAt &&
  first.updatedAt === second.updatedAt &&
  first.status === second.status &&
  first.lastTurnOutcome === second.lastTurnOutcome &&
  arePendingApprovalsEqual(first.pendingApproval, second.pendingApproval) &&
  first.pinned === second.pinned &&
  first.sidebarOrder === second.sidebarOrder &&
  first.done === second.done &&
  first.doneAt === second.doneAt &&
  first.seenUpdatedAt === second.seenUpdatedAt &&
  first.purpose === second.purpose &&
  areContainerTargetsEqual(first.container, second.container)

export const getChatFromUpdateSummary = (
  providerId: ProviderId,
  summary: ProviderChatUpdateSummary,
  existingChat: ProviderChat | null,
  turnCompleted: boolean
): ProviderChat => {
  const container = summary.container ?? existingChat?.container ?? null
  const summaryChanged =
    !existingChat ||
    existingChat.title !== summary.title ||
    existingChat.accountId !== summary.accountId ||
    existingChat.noProject !== summary.noProject ||
    existingChat.cwd !== summary.cwd ||
    existingChat.cwdKind !== summary.cwdKind ||
    existingChat.projectCwd !== summary.projectCwd ||
    existingChat.branchName !== summary.branchName ||
    existingChat.worktreeBaseBranchName !== summary.worktreeBaseBranchName ||
    existingChat.status !== summary.status ||
    existingChat.lastTurnOutcome !== summary.lastTurnOutcome ||
    !arePendingApprovalsEqual(existingChat.pendingApproval, summary.pendingApproval) ||
    existingChat.pinned !== summary.pinned ||
    existingChat.sidebarOrder !== summary.sidebarOrder ||
    existingChat.done !== summary.done ||
    existingChat.doneAt !== summary.doneAt ||
    existingChat.seenUpdatedAt !== summary.seenUpdatedAt ||
    existingChat.purpose !== summary.purpose ||
    !areContainerTargetsEqual(existingChat.container, container)

  return {
    id: summary.id,
    accountId: summary.accountId ?? existingChat?.accountId,
    noProject: summary.noProject ?? existingChat?.noProject,
    imported: summary.imported ?? existingChat?.imported,
    providerId,
    title: summary.title,
    preview: !existingChat || turnCompleted ? summary.preview : existingChat.preview,
    cwd: summary.cwd,
    cwdKind: summary.cwdKind,
    projectCwd: summary.projectCwd,
    branchName: summary.branchName,
    worktreeBaseBranchName: summary.worktreeBaseBranchName,
    createdAt: summary.createdAt,
    updatedAt:
      !existingChat || summaryChanged || turnCompleted ? summary.updatedAt : existingChat.updatedAt,
    status: summary.status,
    lastTurnOutcome:
      summary.lastTurnOutcome === undefined
        ? existingChat?.lastTurnOutcome
        : summary.lastTurnOutcome,
    pendingApproval: summary.pendingApproval,
    pinned: summary.pinned,
    sidebarOrder: summary.sidebarOrder,
    done: summary.done,
    doneAt: summary.doneAt ?? null,
    seenUpdatedAt:
      existingChat?.seenUpdatedAt == null
        ? summary.seenUpdatedAt
        : summary.seenUpdatedAt == null
          ? existingChat.seenUpdatedAt
          : Math.max(existingChat.seenUpdatedAt, summary.seenUpdatedAt),
    purpose: summary.purpose,
    container
  }
}

export const getOptimisticItems = (
  items: ProviderChatItem[],
  message: string,
  attachments: AppSelectedAttachment[] = [],
  review?: Omit<ProviderReview, 'prompt'> | null
): ProviderChatItem[] => {
  const createdAt = Date.now()
  const id = `${optimisticChatItemIdPrefix}${createdAt}`

  return [
    ...items,
    {
      type: 'message',
      id: `${id}:user`,
      editTargetId: null,
      role: 'user',
      content: message.trim(),
      attachments: [
        ...attachments.map((attachment) =>
          attachment.kind === 'image'
            ? {
                kind: attachment.kind,
                name: attachment.name,
                path: attachment.path,
                dataUrl: attachment.dataUrl
              }
            : {
                kind: attachment.kind,
                name: attachment.name,
                path: attachment.path
              }
        ),
        ...(review
          ? [
              {
                kind: 'review' as const,
                id: review.id,
                comments: review.comments
              }
            ]
          : [])
      ] satisfies NonNullable<ProviderMessage['attachments']>,
      createdAt
    },
    {
      type: 'working',
      id: `${id}:working`,
      status: 'working',
      startedAt: createdAt,
      items: []
    }
  ]
}

export const formatReviewComments = (comments: ProviderReviewComment[]): string => {
  const commentsByPath = new Map<string, string[]>()

  comments.forEach(({ path, comment, line, endLine }) => {
    const normalizedEndLine = Math.max(line, endLine ?? line)
    const location =
      normalizedEndLine === line ? `Line ${line}` : `Lines ${line}-${normalizedEndLine}`
    const locatedComment = `${location}: ${comment}`
    const pathComments = commentsByPath.get(path)
    if (pathComments) pathComments.push(locatedComment)
    else commentsByPath.set(path, [locatedComment])
  })

  return Array.from(commentsByPath, ([path, pathComments]) =>
    pathComments.length === 1
      ? `${path}: ${pathComments[0]}`
      : `${path}:\n${pathComments.map((comment) => `- ${comment.replace(/\n/g, '\n  ')}`).join('\n')}`
  ).join('\n\n')
}

export const serializeReviewMessage = (
  prompt: string,
  review: Omit<ProviderReview, 'prompt'>
): string => [prompt.trim(), formatReviewComments(review.comments)].filter(Boolean).join('\n\n')

export const escapeSkillName = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const escapeAppLinkLabel = (value: string): string => value.replace(/[\\[\]]/g, '\\$&')

export const serializeComposerMessage = (
  message: string,
  skills: ProviderSkillInput[],
  apps: ProviderAppInput[]
): string => {
  const missingSkillMentions = skills
    .filter(
      (skill) =>
        !new RegExp(`(^|[\\s([{])\\$${escapeSkillName(skill.name)}(?=$|[\\s)\\]},.!?;:])`).test(
          message
        )
    )
    .map((skill) => `$${skill.name}`)
  const missingAppMentions = apps
    .filter((app) => !message.includes(`app://${app.id}`))
    .map((app) => `[$${escapeAppLinkLabel(app.name)}](app://${app.id})`)

  return [[...missingSkillMentions, ...missingAppMentions].join(' '), message]
    .filter(Boolean)
    .join('\n')
}

export const getWorktreeBranchGenerationPrompt = (
  prompt: string,
  settings: AppGitWorktreeSettings
): string => {
  const template = settings.branchNamePrompt.trim()
  if (!template) return `Prompt:\n\`\`\`${prompt}\`\`\``

  return template.includes('{prompt}')
    ? template.replaceAll('{prompt}', prompt)
    : [template, `Prompt:\n\`\`\`${prompt}\`\`\``].join('\n\n')
}

export const normalizeGeneratedWorktreeName = (value: string): string | null => {
  const name = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^agents\//, '')
    .trim()

  return name || null
}

export const hasActiveWorkingStep = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'working' && item.status === 'working') ?? false

export const hasPendingSteeringMessage = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'pendingMessage' && item.kind === 'steering') ?? false

export const activeCommitActivityLabelReplacements: Array<[RegExp, string]> = [
  [/^Read\b/, 'Reading'],
  [/^Searched\b/, 'Searching'],
  [/^Checked\b/, 'Checking'],
  [/^Viewed\b/, 'Viewing'],
  [/^Ran\b/, 'Running'],
  [/^Used\b/, 'Using'],
  [/^Changed\b/, 'Changing'],
  [/^Created\b/, 'Creating'],
  [/^Deleted\b/, 'Deleting'],
  [/^Applied\b/, 'Applying'],
  [/^Updated\b/, 'Updating'],
  [/^Generated\b/, 'Generating']
]

export const getCommitActivityActionFromLabel = (
  label: string,
  activity: ProviderToolActivity,
  icon?: ProviderToolIcon | null
): CommitActivityAction => ({
  label: getActiveCommitActivityLabel(label) ?? 'Working',
  activity,
  icon
})

export const getActiveCommitActivityLabel = (label: string): string | null => {
  const trimmedLabel = label.trim()
  if (!trimmedLabel || trimmedLabel === 'Tool use') return null

  for (const [pattern, replacement] of activeCommitActivityLabelReplacements) {
    if (pattern.test(trimmedLabel)) return trimmedLabel.replace(pattern, replacement)
  }

  return trimmedLabel
}

export const getActiveCommitToolAction = (tool: ProviderWorkingTool): CommitActivityAction => {
  return getCommitActivityActionFromLabel(tool.label, tool.activity, tool.icon)
}

export const getWorkingItemTools = (item: ProviderWorkingItem): ProviderWorkingTool[] => {
  if (item.type === 'tool') return [item]
  if (item.type === 'toolGroup') return item.tools
  return []
}

export const planItemStatuses = new Set<ChatPlanItem['status']>([
  'pending',
  'in_progress',
  'completed'
])

export const getToolInputRecord = (rawInput: unknown): Record<string, unknown> | null => {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>
  }
  if (typeof rawInput !== 'string') return null

  const trimmedInput = rawInput.trim()
  const objectStart = trimmedInput.indexOf('{')
  const objectEnd = trimmedInput.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) return null

  try {
    const parsedInput = JSON.parse(trimmedInput.slice(objectStart, objectEnd + 1)) as unknown
    return parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput)
      ? (parsedInput as Record<string, unknown>)
      : null
  } catch (error) {
    console.error('[caught:chatControllerUtils:getToolInputRecord]', error)
    return null
  }
}

export const getPlanSignature = (items: ChatPlanItem[]): string => {
  const serializedItems = JSON.stringify(items)
  let hash = 2_166_136_261

  for (let index = 0; index < serializedItems.length; index += 1) {
    hash ^= serializedItems.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return `${items.length}:${(hash >>> 0).toString(36)}`
}

export const getPlanFromTool = (
  tool: ProviderWorkingTool,
  contextKey: string
): ChatPlanData | null => {
  if (tool.toolId !== 'update_plan') return null

  const input = getToolInputRecord(tool.rawInput)
  if (!input || !Array.isArray(input.plan)) return null

  const items = input.plan.flatMap((item): ChatPlanItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []

    const candidate = item as Record<string, unknown>
    const step = typeof candidate.step === 'string' ? candidate.step.trim() : ''
    const status = candidate.status
    if (
      !step ||
      typeof status !== 'string' ||
      !planItemStatuses.has(status as ChatPlanItem['status'])
    ) {
      return []
    }

    return [{ step, status: status as ChatPlanItem['status'] }]
  })
  if (items.length === 0) return null

  const explanation =
    typeof input.explanation === 'string' && input.explanation.trim()
      ? input.explanation.trim()
      : null

  return {
    contextKey,
    explanation,
    items,
    signature: getPlanSignature(items)
  }
}

export const getLatestChatPlan = (
  items: readonly ProviderChatItem[] | null | undefined,
  contextKey: string | null
): ChatPlanData | null => {
  if (!items || !contextKey) return null

  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex]
    if (item.type !== 'working') continue

    for (
      let workingItemIndex = item.items.length - 1;
      workingItemIndex >= 0;
      workingItemIndex -= 1
    ) {
      const tools = getWorkingItemTools(item.items[workingItemIndex])

      for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
        const plan = getPlanFromTool(tools[toolIndex], contextKey)
        if (plan) return plan
      }
    }
  }

  return null
}

export const getCommitActivityCurrentAction = (
  detail: ProviderChatDetail,
  fallbackAction: GitCommitPromptAction
): CommitActivityAction => {
  const workingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working' && item.status === 'working'
  )
  const tools = workingStep?.items.flatMap(getWorkingItemTools) ?? []
  const activeTool = tools.findLast((tool) => tool.status === 'running') ?? tools.at(-1)
  if (activeTool) return getActiveCommitToolAction(activeTool)

  const workingMessage = workingStep?.items.findLast(
    (item): item is Extract<ProviderWorkingItem, { type: 'message' }> =>
      item.type === 'message' && item.content.trim().length > 0
  )
  if (workingMessage) {
    return {
      label: workingMessage.content.trim(),
      activity: 'other'
    }
  }

  return {
    label: `Preparing ${commitActionLabels[fallbackAction].toLocaleLowerCase()}`,
    activity: 'other'
  }
}

export const getCommitActivityCurrentActionFromSummary = (
  summary: ProviderChatUpdateSummary,
  fallbackAction: GitCommitPromptAction
): CommitActivityAction => {
  if (summary.currentActivity) {
    return getCommitActivityActionFromLabel(
      summary.currentActivity.label,
      summary.currentActivity.activity
    )
  }

  return {
    label: `Preparing ${commitActionLabels[fallbackAction].toLocaleLowerCase()}`,
    activity: 'other'
  }
}

export const getDirectCommitActivityAction = (
  action: GitCommitPromptAction
): CommitActivityAction =>
  getCommitActivityActionFromLabel(
    action === 'amend' ? 'Ran git commit --amend' : 'Ran git commit',
    'git'
  )

export const isAsciiWhitespaceCode = (code: number): boolean =>
  code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32

export const getTrimmedAsciiLength = (text: string): number => {
  let startIndex = 0
  let endIndex = text.length

  while (startIndex < endIndex && isAsciiWhitespaceCode(text.charCodeAt(startIndex))) {
    startIndex += 1
  }
  while (endIndex > startIndex && isAsciiWhitespaceCode(text.charCodeAt(endIndex - 1))) {
    endIndex -= 1
  }

  return endIndex - startIndex
}

export const estimateTokenCount = (text: string): number => {
  const normalizedLength = getTrimmedAsciiLength(text)
  if (normalizedLength === 0) return 0

  return Math.max(1, Math.ceil(normalizedLength / 4))
}

export const getWorkingItemEstimatedTokens = (item: ProviderWorkingItem): number => {
  if (item.type === 'message') return estimateTokenCount(item.content)
  if (item.type === 'tool') {
    return (
      estimateTokenCount(item.label) +
      estimateTokenCount(item.command ?? '') +
      estimateTokenCount(item.stdout ?? '')
    )
  }
  if (item.type === 'toolGroup') {
    return item.tools.reduce((total, tool) => total + getWorkingItemEstimatedTokens(tool), 0)
  }

  return 0
}

export const getChatItemEstimatedTokens = (item: ProviderChatItem): number => {
  if (item.type === 'message') return estimateTokenCount(item.content)
  if (item.type === 'pendingMessage') return estimateTokenCount(item.content)
  if (item.type === 'working') {
    return item.items.reduce(
      (total, workingItem) => total + getWorkingItemEstimatedTokens(workingItem),
      0
    )
  }

  return 0
}

export const getEstimatedContextTokens = (
  items: readonly ProviderChatItem[] | null | undefined
): number | null => {
  if (!items) return null

  return items.reduce((total, item) => total + getChatItemEstimatedTokens(item), 0)
}

export const mergeAccountUsage = (
  currentUsage: ProviderAccountUsage | null,
  nextUsage: ProviderAccountUsage
): ProviderAccountUsage => {
  if (nextUsage.statisticsLoaded || !currentUsage?.statisticsLoaded) return nextUsage

  return {
    ...nextUsage,
    statisticsLoaded: true,
    summary: currentUsage.summary,
    dailyUsageBuckets: currentUsage.dailyUsageBuckets
  }
}

export const formatExtraUserInstructionsForPrompt = (
  instructions: string,
  promptSettings: AppGitCommitPromptSettings
): string | null => {
  const trimmedInstructions = instructions.trim()
  if (!trimmedInstructions) return null

  const prefix = promptSettings.extraInstructionsPrefix.trim()
  return prefix
    ? `${prefix} ${JSON.stringify(trimmedInstructions)}`
    : JSON.stringify(trimmedInstructions)
}

export const getScopedChatCommitWorkflowStep = (
  action: GitCommitPromptAction,
  promptSettings: AppGitCommitPromptSettings
): string => (action === 'amend' ? promptSettings.amendStep : promptSettings.commitStep)

export const getScopedChatCommitPromptBody = (
  action: GitCommitPromptAction,
  promptSettings: AppGitCommitPromptSettings,
  pushAfterCommit: boolean
): string => {
  const instructions = promptSettings.instructions.trim()
  const workflow = [
    promptSettings.workflow.trim(),
    getScopedChatCommitWorkflowStep(action, promptSettings).trim(),
    pushAfterCommit ? 'After the commit succeeds, push the current branch with `git push`.' : ''
  ]
    .filter(Boolean)
    .join('\n')

  return [instructions, workflow].filter(Boolean).join('\n\n')
}

export const getScopedChatCommitPrompt = (
  action: GitCommitPromptAction,
  extraInstructions: string,
  promptSettings: AppGitCommitPromptSettings,
  pushAfterCommit = false
): string => {
  return [
    getScopedChatCommitPromptBody(action, promptSettings, pushAfterCommit),
    formatExtraUserInstructionsForPrompt(extraInstructions, promptSettings)
  ]
    .filter((line): line is string => line != null)
    .join('\n')
}

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()

  return message || fallback
}

export const isGitChangesScope = (
  scope: GitChangesScope | null,
  sourceKey: string,
  cwd: string | null,
  source: GitChangeSource | null
): boolean =>
  Boolean(
    scope &&
      cwd &&
      source &&
      scope.sourceKey === sourceKey &&
      scope.cwd === cwd &&
      scope.source === source
  )

export const isFileTreeScope = (
  scope: FileTreeScope | null,
  containerKey: string,
  cwd: string | null
): boolean => Boolean(scope && cwd && scope.containerKey === containerKey && scope.cwd === cwd)

export const getChangesEmptyMessage = (
  source: ChangeSource,
  cwd: string | null,
  options: { hasNonReadOnlyTools?: boolean; hasUncommittedChanges?: boolean } = {}
): string => {
  if (source === 'lastTurn') {
    if (options.hasNonReadOnlyTools && options.hasUncommittedChanges) {
      return 'Command changes will be scoped by the chat when committed.'
    }
    return 'No files changed in the last turn.'
  }
  if (source === 'chat') {
    if (options.hasNonReadOnlyTools && options.hasUncommittedChanges) {
      return 'Command changes will be scoped by the chat when committed.'
    }
    return 'No files changed in this chat.'
  }
  if (!cwd) return 'Choose a folder to see changes.'

  return `No ${changeSourceLabels[source].toLocaleLowerCase()} changes.`
}
