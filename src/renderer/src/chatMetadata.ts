import type { ProviderChatMetadata } from '../../shared/provider'

type ChatMetadataTarget = Omit<ProviderChatMetadata, 'id'>

const chatUpdatePreviewLimit = 500

export type ComparableChatPreview = {
  preview: string
  length: number
}

export const getComparableChatPreview = (
  content: string | null | undefined
): ComparableChatPreview | null => {
  const preview = content?.trim()
  if (!preview) return null
  return {
    preview:
      preview.length <= chatUpdatePreviewLimit
        ? preview
        : `${preview.slice(0, chatUpdatePreviewLimit - 1)}…`,
    length: preview.length
  }
}

export const isViewedChatCompletion = (
  viewedPreview: ComparableChatPreview | null | undefined,
  updatePreview: string,
  updatePreviewLength: number,
  turnCompleted: boolean
): boolean =>
  Boolean(
    turnCompleted &&
      viewedPreview &&
      viewedPreview.preview === updatePreview &&
      viewedPreview.length === updatePreviewLength
  )

/** Maps `items`, returning the original array when every element is unchanged. */
export const mapPreservingIdentity = <Item>(
  items: Item[],
  update: (item: Item) => Item
): Item[] => {
  let next: Item[] | null = null
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const updated = update(item)
    if (updated !== item) {
      next ??= items.slice()
      next[index] = updated
    }
  }
  return next ?? items
}

type ChatContainer = ChatMetadataTarget['container']

const areContainersEqual = (
  first: ChatContainer | undefined,
  second: ChatContainer | undefined
): boolean => {
  if (first === second) return true
  if (!first || !second || first.kind !== second.kind) return false
  if (first.kind === 'host' || second.kind === 'host') return true
  if (first.tool !== second.tool || first.name !== second.name) return false
  const firstRuntime = 'runtime' in first ? first.runtime : undefined
  const secondRuntime = 'runtime' in second ? second.runtime : undefined
  return areContainersEqual(firstRuntime, secondRuntime)
}

export const mergeSeenUpdatedAt = (
  current: number | null | undefined,
  next: number | null | undefined
): number | null => (current == null ? (next ?? null) : Math.max(current, next ?? 0))

/**
 * Returns `target` itself when the metadata changes nothing. Every chat switch
 * merges seen metadata several times; new objects would rerender the sidebar
 * row, the selected chat and every message that compares its container.
 */
export const mergeChatMetadata = <Target extends ChatMetadataTarget>(
  target: Target,
  metadata: ProviderChatMetadata
): Target => {
  const noProject = metadata.noProject ?? target.noProject
  const doneAt = metadata.doneAt ?? null
  const seenUpdatedAt = mergeSeenUpdatedAt(target.seenUpdatedAt, metadata.seenUpdatedAt)
  const container =
    metadata.container && !areContainersEqual(metadata.container, target.container)
      ? metadata.container
      : target.container
  if (
    noProject === target.noProject &&
    metadata.pinned === target.pinned &&
    metadata.sidebarOrder === target.sidebarOrder &&
    metadata.done === target.done &&
    doneAt === (target.doneAt ?? null) &&
    'doneAt' in target &&
    seenUpdatedAt === target.seenUpdatedAt &&
    metadata.purpose === target.purpose &&
    container === target.container
  ) {
    return target
  }
  return {
    ...target,
    noProject,
    pinned: metadata.pinned,
    sidebarOrder: metadata.sidebarOrder,
    done: metadata.done,
    doneAt,
    seenUpdatedAt,
    purpose: metadata.purpose,
    container
  }
}
