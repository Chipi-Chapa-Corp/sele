import type { ProviderChatMetadata } from '../../shared/provider'

const listeners = new Set<(metadata: ProviderChatMetadata[]) => void>()
export const onChatMetadataChanged = (
  listener: (metadata: ProviderChatMetadata[]) => void
): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const publishChatMetadataChanged = (metadata: ProviderChatMetadata[]): void => {
  if (!metadata.length) return
  for (const listener of listeners) {
    try {
      listener(metadata)
    } catch (error) {
      console.error('Unable to publish chat metadata changes.', error)
    }
  }
}
