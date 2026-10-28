import type { ProviderChatMetadata, ProviderId } from '../../shared/provider'

// Navigation can mark the same snapshot seen on selection, refresh and departure.
// Share pending writes and remember durable acknowledgements, never failed writes.
export const createChatSeenWriter = (
  persist: (
    providerId: ProviderId,
    chatId: string,
    timestamp: number
  ) => Promise<ProviderChatMetadata>,
  limit = 256
) => {
  const saved = new Map<string, number>()
  const pending = new Map<string, { timestamp: number; request: Promise<ProviderChatMetadata> }>()
  return (providerId: ProviderId, chatId: string, timestamp: number) => {
    const key = `${providerId}:${chatId}`
    if ((saved.get(key) ?? -1) >= timestamp) return Promise.resolve(null)
    const current = pending.get(key)
    if (current && current.timestamp >= timestamp) return current.request
    const request = persist(providerId, chatId, timestamp)
      .then((metadata) => {
        saved.set(key, Math.max(saved.get(key) ?? -1, metadata.seenUpdatedAt ?? timestamp))
        while (saved.size > limit) saved.delete(saved.keys().next().value!)
        return metadata
      })
      .finally(() => {
        if (pending.get(key)?.request === request) pending.delete(key)
      })
    pending.set(key, { timestamp, request })
    return request
  }
}
