import { isProviderId, type ProviderId } from '../../shared/provider.ts'

/** Drag payload for a sidebar chat; files keep using the native `Files` type. */
export const linkedChatDragType = 'application/x-sele-chat'

export const defaultLinkedChatSummaryPrompt =
  'Write a markdown summary of this thread for context of another agent'

export const maxLinkedChatCount = 5

export type LinkedChatReference = {
  providerId: ProviderId
  chatId: string
  name: string
}

export type LinkedChatContext = LinkedChatReference & {
  summary: string
}

export type ComposerLinkedChat = LinkedChatReference & {
  operationId: string
  status: 'loading' | 'ready' | 'failed'
  summary?: string
  error?: string
}

export const getLinkedChatKey = (
  chat: Pick<LinkedChatReference, 'providerId' | 'chatId'>
): string => `${chat.providerId}:${chat.chatId}`

export const serializeLinkedChatDrag = (chat: LinkedChatReference): string =>
  JSON.stringify({ providerId: chat.providerId, chatId: chat.chatId, name: chat.name })

export const hasLinkedChatDrag = (types: readonly string[]): boolean =>
  types.includes(linkedChatDragType)

export const parseLinkedChatDrag = (value: string): LinkedChatReference | null => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (!isProviderId(parsed.providerId)) return null
    if (typeof parsed.chatId !== 'string' || !parsed.chatId) return null
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Chat'
    return { providerId: parsed.providerId, chatId: parsed.chatId, name }
  } catch {
    return null
  }
}

const sectionHeading = '# Linked chats'
const requestHeading = '# User request:'
const contextTag = 'linked-chat-context'

const escapeAttribute = (value: string): string =>
  value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const unescapeAttribute = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** A summary must not be able to close its own block early. */
const escapeSummary = (summary: string): string =>
  summary.trim().replace(/<\/linked-chat-context/gi, '<\\/linked-chat-context')

/**
 * Prompt sent to the provider. The source provider and chat ID let Sele open the original
 * chat later; the agent only needs the name and summary.
 */
export const buildLinkedChatPrompt = (
  contexts: readonly LinkedChatContext[],
  request: string
): string => {
  if (contexts.length === 0) return request
  return [
    sectionHeading,
    ...contexts.map(
      (context) =>
        `<${contextTag} name="${escapeAttribute(context.name)}" provider="${context.providerId}" chat-id="${escapeAttribute(context.chatId)}">\n${escapeSummary(context.summary)}\n</${contextTag}>`
    ),
    requestHeading,
    request
  ].join('\n')
}

const linkedChatSectionPattern =
  /(^|\r?\n)# Linked chats\r?\n((?:<linked-chat-context\b[^>\n]*>\r?\n[\s\S]*?\r?\n<\/linked-chat-context>\r?\n)+)# User request:[ \t]*(?:\r?\n|$)/
const linkedChatBlockPattern =
  /<linked-chat-context\b([^>\n]*)>\r?\n[\s\S]*?\r?\n<\/linked-chat-context>/g
const attributePattern = /([a-z][a-z-]*)="([^"]*)"/g

const parseAttributes = (source: string): Record<string, string> =>
  Object.fromEntries(
    Array.from(source.matchAll(attributePattern), (match) => [
      match[1]!,
      unescapeAttribute(match[2]!)
    ])
  )

/** Removes the injected section from a sent message, returning chips for its linked chats. */
export const extractLinkedChats = (
  content: string
): { content: string; linkedChats: LinkedChatReference[] } => {
  const section = linkedChatSectionPattern.exec(content)
  if (!section) return { content, linkedChats: [] }

  const linkedChats = Array.from(section[2]!.matchAll(linkedChatBlockPattern), (block) => {
    const attributes = parseAttributes(block[1]!)
    const providerId = attributes.provider
    return {
      providerId: isProviderId(providerId) ? providerId : null,
      chatId: attributes['chat-id'] ?? '',
      name: attributes.name?.trim() || 'Chat'
    }
  }).filter((chat): chat is LinkedChatReference => chat.providerId !== null && Boolean(chat.chatId))

  // Text before the section comes from the provider (for example a skill invocation).
  const before = content.slice(0, section.index).trimEnd()
  const after = content.slice(section.index + section[0].length)
  return {
    content: before ? `${before}${section[1] || '\n'}${after}` : after,
    linkedChats
  }
}
