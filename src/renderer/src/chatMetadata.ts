import type { ProviderChatMetadata } from '../../shared/provider'

type ChatMetadataTarget = Omit<ProviderChatMetadata, 'id'>

export const mergeChatMetadata = <Target extends ChatMetadataTarget>(
  target: Target,
  metadata: ProviderChatMetadata
): Target => ({
  ...target,
  pinned: metadata.pinned,
  pinnedOrder: metadata.pinnedOrder,
  done: metadata.done,
  seenUpdatedAt: metadata.seenUpdatedAt,
  purpose: metadata.purpose,
  container: metadata.container ?? target.container
})
