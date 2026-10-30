import type { ProviderChatItem } from '../../shared/provider'

// Provider IDs remain authoritative for actions and pagination. React identity
// also spans the optimistic -> confirmed handoff, so decoded media, selection
// and animations belong to one mounted message throughout its lifetime.
const renderKeys = new WeakMap<ProviderChatItem, string>()

export const getChatItemRenderKey = (item: ProviderChatItem): string =>
  renderKeys.get(item) ?? item.id

export const reconcileChatItemRenderKeys = (
  previous: readonly ProviderChatItem[],
  incoming: readonly ProviderChatItem[],
  byId: ReadonlyMap<string, ProviderChatItem>
): void => {
  let precedingUser: string | null = null
  const optimistic: { item: ProviderChatItem; precedingUser: string | null }[] = []
  for (const item of previous) {
    if (item.type !== 'message' || item.role !== 'user') continue
    if (item.id.startsWith('optimistic:')) optimistic.push({ item, precedingUser })
    else precedingUser = item.id
  }
  const encountered = new Set<string>()
  let nextOptimistic = 0
  for (const item of incoming) {
    encountered.add(item.id)
    const old = byId.get(item.id)
    if (old) {
      const key = getChatItemRenderKey(old)
      if (key !== item.id) renderKeys.set(item, key)
      if (optimistic[nextOptimistic]?.item === old) nextOptimistic++
      continue
    }
    const candidate = optimistic[nextOptimistic]
    const pending = candidate?.item
    if (
      item.type !== 'message' ||
      item.role !== 'user' ||
      item.id.startsWith('optimistic:') ||
      pending?.type !== 'message' ||
      item.content.trim() !== pending.content.trim()
    )
      continue
    // Only replace an optimistic message in the same loaded history window.
    // A newly paged historical prompt with identical text is not its echo.
    if (candidate.precedingUser && !encountered.has(candidate.precedingUser)) continue
    const oldAttachments = pending.attachments ?? []
    const newAttachments = item.attachments ?? []
    if (
      oldAttachments.length !== newAttachments.length ||
      oldAttachments.some((attachment, i) => {
        const next = newAttachments[i]
        return (
          attachment.kind !== next.kind ||
          ('path' in attachment && 'path' in next && attachment.path !== next.path)
        )
      })
    )
      continue
    renderKeys.set(item, getChatItemRenderKey(pending))
    nextOptimistic++
  }
}
