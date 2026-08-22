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

export const mergeChatMetadata = <Target extends ChatMetadataTarget>(
  target: Target,
  metadata: ProviderChatMetadata
): Target => ({
  ...target,
  pinned: metadata.pinned,
  sidebarOrder: metadata.sidebarOrder,
  done: metadata.done,
  seenUpdatedAt: metadata.seenUpdatedAt,
  purpose: metadata.purpose,
  container: metadata.container ?? target.container
})
