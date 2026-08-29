import type {
  ProviderChatDetail,
  ProviderChatItem,
  ProviderMessage,
  ProviderPendingMessage
} from '../../shared/provider'
import { getProviderChatTurnCount, sliceProviderChatTurns } from '../../shared/chatTurns.ts'
import { unloadHistoricalWorkingSteps } from './workingStepLazy.ts'

export const rendererChatTurnPageSize = 10
export const rendererChatPagePayloadBudgetCharacters = 4_000_000
export const rendererMessagePayloadPreviewCharacters = 512_000
export const rendererMessageAttachmentLimit = 20
export const rendererReviewCommentLimit = 50

const truncatedMessageMarker = '\n… [truncated to keep the app responsive]'

const countStringCharacters = (value: unknown, seen = new WeakSet<object>()): number => {
  if (typeof value === 'string') return value.length
  if (!value || typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return values.reduce((total, entry) => total + countStringCharacters(entry, seen), 0)
}

const truncateMessageContent = (content: string, limit: number): string => {
  if (content.length <= limit) return content
  if (limit <= truncatedMessageMarker.length) return content.slice(0, Math.max(0, limit))
  return `${content.slice(0, limit - truncatedMessageMarker.length)}${truncatedMessageMarker}`
}

const removeLargeAttachmentPayloads = <TMessage extends ProviderMessage | ProviderPendingMessage>(
  message: TMessage
): TMessage['attachments'] =>
  message.attachments?.slice(-rendererMessageAttachmentLimit).map((attachment) => {
    if (attachment.kind === 'image') return { ...attachment, dataUrl: null }
    if (attachment.kind !== 'review') return attachment
    return {
      ...attachment,
      comments: attachment.comments.slice(-rendererReviewCommentLimit).map((comment) => ({
        ...comment,
        comment: truncateMessageContent(comment.comment, 16_000)
      }))
    }
  })

const hasOversizedAttachmentCollection = <
  TMessage extends ProviderMessage | ProviderPendingMessage
>(
  message: TMessage
): boolean =>
  (message.attachments?.length ?? 0) > rendererMessageAttachmentLimit ||
  Boolean(
    message.attachments?.some(
      (attachment) =>
        attachment.kind === 'review' && attachment.comments.length > rendererReviewCommentLimit
    )
  )

const prepareMessagePayload = <TMessage extends ProviderMessage | ProviderPendingMessage>(
  message: TMessage,
  remainingCharacters: number
): { item: TMessage; retainedCharacters: number } => {
  const payloadCharacterCount = message.content.length + countStringCharacters(message.attachments)
  const contentLimit = Math.max(
    0,
    Math.min(rendererMessagePayloadPreviewCharacters, remainingCharacters)
  )
  if (payloadCharacterCount <= contentLimit && !hasOversizedAttachmentCollection(message)) {
    return { item: message, retainedCharacters: payloadCharacterCount }
  }

  let attachments = removeLargeAttachmentPayloads(message)
  let retainedAttachmentCharacters = countStringCharacters(attachments)
  if (retainedAttachmentCharacters > remainingCharacters) {
    attachments = undefined
    retainedAttachmentCharacters = 0
  }
  const boundedContentLimit = Math.max(
    0,
    Math.min(
      rendererMessagePayloadPreviewCharacters,
      remainingCharacters - retainedAttachmentCharacters
    )
  )
  const content = truncateMessageContent(message.content, boundedContentLimit)
  return {
    item: {
      ...message,
      content,
      contentLoaded: true,
      contentCharacterCount: message.content.length,
      contentTruncated: content.length < message.content.length,
      attachments,
      payloadCharacterCount,
      payloadTruncated: true
    },
    retainedCharacters: retainedAttachmentCharacters + content.length
  }
}

export const prepareChatItemsForRenderer = (items: ProviderChatItem[]): ProviderChatItem[] => {
  let remainingCharacters = rendererChatPagePayloadBudgetCharacters
  let changed = false
  const preparedItems = items.map((item) => {
    if (item.type !== 'message' && item.type !== 'pendingMessage') return item
    const prepared = prepareMessagePayload(item, remainingCharacters)
    remainingCharacters = Math.max(0, remainingCharacters - prepared.retainedCharacters)
    if (prepared.item !== item) changed = true
    return prepared.item
  })
  return changed ? preparedItems : items
}

export const prepareChatDetailForRenderer = (detail: ProviderChatDetail): ProviderChatDetail => {
  const detailIsWindowed =
    Number.isSafeInteger(detail.itemsStartTurnIndex) &&
    detail.itemsStartTurnIndex! >= 0 &&
    Number.isSafeInteger(detail.turnCount) &&
    detail.turnCount! >= detail.itemsStartTurnIndex!
  const turnCount = detailIsWindowed ? detail.turnCount! : getProviderChatTurnCount(detail.items)
  const itemsStartTurnIndex = detailIsWindowed
    ? detail.itemsStartTurnIndex!
    : Math.max(0, turnCount - rendererChatTurnPageSize)
  const items = detailIsWindowed
    ? detail.items
    : sliceProviderChatTurns(detail.items, itemsStartTurnIndex, turnCount)

  const workingStepsUnloaded = unloadHistoricalWorkingSteps({
    ...detail,
    items,
    itemsStartTurnIndex,
    turnCount
  })
  const preparedItems = prepareChatItemsForRenderer(workingStepsUnloaded.items)
  return preparedItems === workingStepsUnloaded.items
    ? workingStepsUnloaded
    : { ...workingStepsUnloaded, items: preparedItems }
}
