import type {
  ProviderApi,
  ProviderChat,
  ProviderChatActivitySummary,
  ProviderChatDetail,
  ProviderChatMetadata,
  ProviderChatUpdateSummary,
  ProviderChatUpdatedEvent,
  ProviderId,
  ProviderReview,
  ProviderUserInputResponse,
  ProviderUsageOptions,
  ProviderWorkingItem,
  ProviderWorkingStep
} from '../../shared/provider'
import {
  getChatMetadata,
  getChatMetadataByIds,
  setChatContainer,
  setChatDone,
  setChatPinned,
  setPinnedChatOrder,
  setChatPurpose,
  setChatSeen,
  setChatsDone
} from '../database/chat'
import { getCwdNotes, setCwdNotes } from '../database/cwdNotes'
import {
  deleteMessageReview,
  getMessageReviews,
  setMessageReview
} from '../database/messageReviews'
import { CodexProviderAdapter } from './codex/CodexProviderAdapter'
import { ClaudeProviderAdapter } from './claude/ClaudeProviderAdapter'
import { CopilotProviderAdapter } from './copilot/CopilotProviderAdapter'
import { OpenCodeProviderAdapter } from './opencode/OpenCodeProviderAdapter'
import { getCwdMetadata } from './cwdMetadata'
import type { ProviderAdapter } from './ProviderAdapter'

const adapters: Record<ProviderId, ProviderAdapter> = {
  codex: new CodexProviderAdapter(),
  claude: new ClaudeProviderAdapter(),
  copilot: new CopilotProviderAdapter(),
  opencode: new OpenCodeProviderAdapter()
}

const chatUpdatePreviewLimit = 500
const chatUpdateActivityLabelLimit = 240

const truncateChatUpdateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

const chatUpdatedListeners = new Set<(event: ProviderChatUpdatedEvent) => void>()

const normalizeCwd = (cwd: string | null | undefined): string | null => {
  const trimmedCwd = cwd?.trim()
  return trimmedCwd || null
}

const applyMetadataToChat = (
  chat: ProviderChat,
  metadata: ProviderChatMetadata | undefined
): ProviderChat => ({
  ...chat,
  pinned: metadata?.pinned ?? false,
  pinnedOrder: metadata?.pinnedOrder ?? null,
  done: metadata?.done ?? false,
  seenUpdatedAt: metadata?.seenUpdatedAt ?? null,
  purpose: metadata?.purpose ?? null,
  container: metadata?.container ?? chat.container ?? null
})

const applyMetadataToChats = async (chats: ProviderChat[]): Promise<ProviderChat[]> => {
  const metadataById = await getChatMetadataByIds(chats.map((chat) => chat.id))
  return Promise.all(
    chats.map(async (chat) => {
      const [cwdMetadata, reviews] = await Promise.all([
        getCwdMetadata(chat.cwd),
        getMessageReviews(chat.id)
      ])
      const previewReview = reviews.find(
        (review) =>
          Boolean(chat.preview) &&
          (review.serializedContent === chat.preview ||
            review.serializedContent.startsWith(chat.preview) ||
            chat.preview.startsWith(review.serializedContent))
      )

      return {
        ...applyMetadataToChat(chat, metadataById.get(chat.id)),
        preview: previewReview
          ? previewReview.prompt || `Review · ${previewReview.comments.length}`
          : chat.preview,
        cwdKind: cwdMetadata.kind,
        projectCwd: cwdMetadata.projectCwd,
        branchName: cwdMetadata.branchName,
        worktreeBaseBranchName: cwdMetadata.worktreeBaseBranchName
      }
    })
  )
}

const applyMetadataToDetail = async (detail: ProviderChatDetail): Promise<ProviderChatDetail> => {
  const [metadata, cwdMetadata, reviews] = await Promise.all([
    getChatMetadata(detail.id),
    getCwdMetadata(detail.cwd),
    getMessageReviews(detail.id)
  ])
  const reviewsByContent = new Map<string, typeof reviews>()

  reviews.forEach((review) => {
    const matchingReviews = reviewsByContent.get(review.serializedContent)
    if (matchingReviews) matchingReviews.push(review)
    else reviewsByContent.set(review.serializedContent, [review])
  })

  return {
    ...detail,
    cwdKind: cwdMetadata.kind,
    projectCwd: cwdMetadata.projectCwd,
    branchName: cwdMetadata.branchName,
    worktreeBaseBranchName: cwdMetadata.worktreeBaseBranchName,
    pinned: metadata.pinned,
    pinnedOrder: metadata.pinnedOrder,
    done: metadata.done,
    seenUpdatedAt: metadata.seenUpdatedAt,
    purpose: metadata.purpose,
    container: metadata.container ?? detail.container ?? null,
    items: detail.items.map((item) => {
      if (item.type !== 'message' && item.type !== 'pendingMessage') return item

      const review = reviewsByContent.get(item.content)?.shift()
      if (!review || review.comments.length === 0) return item

      return {
        ...item,
        content: review.prompt,
        attachments: [
          ...(item.attachments ?? []).filter((attachment) => attachment.kind !== 'review'),
          {
            kind: 'review' as const,
            id: review.id,
            comments: review.comments
          }
        ]
      }
    })
  }
}

const runWithStoredReview = async (
  chatId: string,
  serializedContent: string,
  review: ProviderReview | undefined,
  run: () => Promise<ProviderChatDetail>
): Promise<ProviderChatDetail> => {
  if (!review) return run()

  await setMessageReview(chatId, serializedContent, review.prompt, review)
  try {
    return await run()
  } catch (error) {
    await deleteMessageReview(review.id).catch(() => {})
    throw error
  }
}

const getChatUpdateActivity = (detail: ProviderChatDetail): ProviderChatActivitySummary | null => {
  const workingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working' && item.status === 'working'
  )
  if (!workingStep) return null

  const tools = workingStep.items.flatMap((item) =>
    item.type === 'message' ? [] : item.type === 'toolGroup' ? item.tools : [item]
  )
  const activeTool = tools.findLast((tool) => tool.status === 'running') ?? tools.at(-1)
  if (activeTool) {
    return {
      label: truncateChatUpdateText(activeTool.label, chatUpdateActivityLabelLimit),
      activity: activeTool.activity
    }
  }

  const workingMessage = workingStep.items.findLast(
    (item): item is Extract<ProviderWorkingItem, { type: 'message' }> =>
      item.type === 'message' && item.content.trim().length > 0
  )
  return workingMessage
    ? {
        label: truncateChatUpdateText(workingMessage.content.trim(), chatUpdateActivityLabelLimit),
        activity: 'other'
      }
    : null
}

export const getChatUpdateSummary = (
  detail: ProviderChatDetail,
  updatedAt: number
): ProviderChatUpdateSummary => {
  const preview = detail.items.findLast((item) => item.type === 'message')?.content.trim() ?? ''
  return {
    id: detail.id,
    createdAt: detail.createdAt,
    title: detail.title,
    preview: truncateChatUpdateText(preview, chatUpdatePreviewLimit),
    previewLength: preview.length,
    cwd: detail.cwd,
    cwdKind: detail.cwdKind,
    projectCwd: detail.projectCwd,
    branchName: detail.branchName,
    worktreeBaseBranchName: detail.worktreeBaseBranchName,
    updatedAt,
    status: detail.status,
    pendingApproval: detail.pendingApproval,
    pinned: detail.pinned,
    pinnedOrder: detail.pinnedOrder,
    done: detail.done,
    seenUpdatedAt: detail.seenUpdatedAt,
    purpose: detail.purpose,
    container: detail.container,
    currentActivity: getChatUpdateActivity(detail)
  }
}

const collectProviderChatIdsByCwd = async (
  providerId: ProviderId,
  cwd: string | null
): Promise<string[]> => {
  const adapter = adapters[providerId]
  const normalizedCwd = normalizeCwd(cwd)
  const chatIds = new Set<string>()
  let cursor: string | null = null

  do {
    const page = await adapter.getChats({
      cursor,
      limit: 100
    })

    page.chats.forEach((chat) => {
      if (normalizeCwd(chat.cwd) === normalizedCwd) chatIds.add(chat.id)
    })

    cursor = page.nextCursor
  } while (cursor)

  return Array.from(chatIds)
}

for (const adapter of Object.values(adapters)) {
  adapter.onChatUpdated((detail, updateMetadata) => {
    const updatedAt = Date.now()
    void applyMetadataToDetail(detail)
      .then((enrichedDetail) => {
        const event = {
          providerId: adapter.id,
          chatId: enrichedDetail.id,
          detail: enrichedDetail,
          summary: getChatUpdateSummary(enrichedDetail, updatedAt),
          turnCompleted: updateMetadata?.turnCompleted ?? false
        } satisfies ProviderChatUpdatedEvent

        chatUpdatedListeners.forEach((listener) => listener(event))
      })
      .catch((error) => {
        console.error('Unable to apply chat metadata to update', error)
      })
  })
}

export const providerApi: ProviderApi = {
  login: (providerId, options) => adapters[providerId].login(options),
  getUpdateAvailability: (providerId, options) =>
    adapters[providerId].getUpdateAvailability(options),
  updateProvider: (providerId, options) => adapters[providerId].updateProvider(options),
  getApprovalModes: (providerId) => adapters[providerId].getApprovalModes(),
  getSandboxModes: (providerId) => adapters[providerId].getSandboxModes(),
  getModels: (providerId, options) => adapters[providerId].getModels(options),
  getSkills: (providerId, cwd, options) => adapters[providerId].getSkills(cwd, options),
  getApps: (providerId, options) => adapters[providerId].getApps(options),
  setSkillEnabled: (providerId, path, enabled, cwd, options) =>
    adapters[providerId].setSkillEnabled(path, enabled, cwd, options),
  setSkillsEnabled: (providerId, paths, enabled, cwd, options) =>
    adapters[providerId].setSkillsEnabled(paths, enabled, cwd, options),
  setAppEnabled: (providerId, appId, enabled, options) =>
    adapters[providerId].setAppEnabled(appId, enabled, options),
  getUsage: (providerId, options?: ProviderUsageOptions) => adapters[providerId].getUsage(options),
  resetRateLimits: (providerId, options) => adapters[providerId].resetRateLimits(options),
  getChats: async (providerId, options) => {
    const page = await adapters[providerId].getChats(options)
    const chats = await applyMetadataToChats(page.chats)
    return {
      ...page,
      chats: chats.filter((chat) => chat.purpose !== 'commit')
    }
  },
  getChat: async (providerId, chatId) => {
    const metadata = await getChatMetadata(chatId)
    return applyMetadataToDetail(
      await adapters[providerId].getChat(chatId, { container: metadata.container })
    )
  },
  setChatTitle: (providerId, chatId, title) =>
    adapters[providerId]
      .setChatTitle(chatId, title)
      .then((detail) => applyMetadataToDetail(detail)),
  generateOneShot: (providerId, message, options) =>
    adapters[providerId].generateOneShot(message, options),
  cancelOneShot: (providerId, generationId) => adapters[providerId].cancelOneShot(generationId),
  startChat: async (providerId, message, options, purpose) => {
    try {
      const detail = await adapters[providerId].startChat(
        message,
        options,
        purpose || options?.review || options?.container
          ? async (chatId) => {
              await Promise.all([
                purpose ? setChatPurpose(chatId, purpose) : Promise.resolve(),
                options?.container
                  ? setChatContainer(chatId, options.container)
                  : Promise.resolve(),
                options?.review
                  ? setMessageReview(chatId, message, options.review.prompt, options.review)
                  : Promise.resolve()
              ])
            }
          : undefined
      )
      return applyMetadataToDetail(detail)
    } catch (error) {
      if (options?.review) await deleteMessageReview(options.review.id).catch(() => {})
      throw error
    }
  },
  continueChat: (providerId, chatId, message, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].continueChat(chatId, message, options)
    ).then((detail) => applyMetadataToDetail(detail)),
  continueChatInFork: async (providerId, chatId, message, purpose, options) => {
    try {
      const detail = await adapters[providerId].continueChatInFork(
        chatId,
        message,
        options,
        async (forkedChatId) => {
          await Promise.all([
            setChatPurpose(forkedChatId, purpose),
            options?.container
              ? setChatContainer(forkedChatId, options.container)
              : Promise.resolve(),
            options?.review
              ? setMessageReview(forkedChatId, message, options.review.prompt, options.review)
              : Promise.resolve()
          ])
        }
      )
      return applyMetadataToDetail(detail)
    } catch (error) {
      if (options?.review) await deleteMessageReview(options.review.id).catch(() => {})
      throw error
    }
  },
  sendActiveChatMessage: (providerId, chatId, message, mode, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].sendActiveChatMessage(chatId, message, mode, options)
    ).then((detail) => applyMetadataToDetail(detail)),
  deletePendingMessage: (providerId, chatId, messageId) =>
    adapters[providerId]
      .deletePendingMessage(chatId, messageId)
      .then((detail) => applyMetadataToDetail(detail)),
  editPendingMessage: (providerId, chatId, messageId, message, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].editPendingMessage(chatId, messageId, message, options)
    ).then((detail) => applyMetadataToDetail(detail)),
  steerPendingMessage: (providerId, chatId, messageId) =>
    adapters[providerId]
      .steerPendingMessage(chatId, messageId)
      .then((detail) => applyMetadataToDetail(detail)),
  interruptPendingMessage: (providerId, chatId, messageId) =>
    adapters[providerId]
      .interruptPendingMessage(chatId, messageId)
      .then((detail) => applyMetadataToDetail(detail)),
  editMessage: (providerId, chatId, messageId, message, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].editMessage(chatId, messageId, message, options)
    ).then((detail) => applyMetadataToDetail(detail)),
  resolveApproval: (providerId, chatId, decision) =>
    adapters[providerId]
      .resolveApproval(chatId, decision)
      .then((detail) => applyMetadataToDetail(detail)),
  resolveUserInput: (providerId, chatId, requestId, response: ProviderUserInputResponse) =>
    adapters[providerId]
      .resolveUserInput(chatId, requestId, response)
      .then((detail) => applyMetadataToDetail(detail)),
  stopChat: (providerId, chatId) =>
    adapters[providerId].stopChat(chatId).then((detail) => applyMetadataToDetail(detail)),
  markChatDone: (_providerId, chatId, done = true) => setChatDone(chatId, done),
  markCwdChatsDone: async (providerId, cwd) =>
    setChatsDone(await collectProviderChatIdsByCwd(providerId, cwd), true),
  getCwdNotes: (providerId, cwd) => getCwdNotes(providerId, cwd),
  setCwdNotes: (providerId, cwd, notes) => setCwdNotes(providerId, cwd, notes),
  markChatSeen: (_providerId, chatId, seenUpdatedAt) => setChatSeen(chatId, seenUpdatedAt),
  setChatPinned: (_providerId, chatId, pinned) => setChatPinned(chatId, pinned),
  setPinnedChatOrder: (chatIds) => setPinnedChatOrder(chatIds),
  onChatUpdated: (listener) => {
    chatUpdatedListeners.add(listener)
    return () => chatUpdatedListeners.delete(listener)
  }
}

export const disposeProviderAdapters = (): void => {
  Object.values(adapters).forEach((adapter) => adapter.dispose())
}
