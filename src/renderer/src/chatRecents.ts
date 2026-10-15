import { marked, type Token, type Tokens } from 'marked'
import type { ProviderChatItem, ProviderId, ProviderMessage } from '../../shared/provider'
import { getMarkdownFileLinkLabel, getMarkdownFileTarget } from './markdownFileLink.ts'
import { appRecentsMessageLimitDefault } from './performanceSettings.ts'
import { createBoundedTextCache } from './boundedTextCache.ts'

export const recentChatMessageLimit = appRecentsMessageLimitDefault

type RecentChatReferenceBase = {
  label: string
  messageId: string
  role: ProviderMessage['role']
}

export type RecentChatFileReference = RecentChatReferenceBase & {
  kind: 'file'
  path: string
  displayPath: string
  line?: number
  endLine?: number
}

export type RecentChatLinkReference = RecentChatReferenceBase & {
  kind: 'link'
  href: string
}

export type RecentChatReference = RecentChatFileReference | RecentChatLinkReference

export type PinnedChatTextReference = {
  kind: 'text'
  chatId: string
  content: string
  messageId: string
  providerId: ProviderId
  role: ProviderMessage['role']
  turnIndex: number
}

export type RecentChatReferenceKeySource =
  | Pick<RecentChatFileReference, 'kind' | 'path'>
  | Pick<RecentChatLinkReference, 'kind' | 'href'>
  | Pick<PinnedChatTextReference, 'kind' | 'chatId' | 'messageId' | 'providerId'>

const externalLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

const getExternalLinkHref = (href: string): string | null => {
  try {
    const url = new URL(href)
    return externalLinkProtocols.has(url.protocol) ? url.toString() : null
  } catch (error) {
    console.error('[caught:chatRecents:getExternalLinkHref]', error)
    return null
  }
}

const getLinkLabel = (token: Tokens.Link, href: string): string => token.text.trim() || href

const getImageLabel = (token: Tokens.Image, fallback: string): string =>
  token.text.trim() || fallback

type MarkdownReference =
  | Omit<RecentChatFileReference, 'messageId' | 'role'>
  | Omit<RecentChatLinkReference, 'messageId' | 'role'>

const markdownReferenceCache = createBoundedTextCache<MarkdownReference[]>(
  100,
  2_000_000,
  (references) =>
    references.reduce(
      (total, reference) =>
        total +
        reference.label.length +
        (reference.kind === 'file'
          ? reference.path.length + reference.displayPath.length
          : reference.href.length),
      0
    )
)

const extractMarkdownReferences = (content: string): MarkdownReference[] => {
  const references: MarkdownReference[] = []
  const tokens = marked.lexer(content)

  marked.walkTokens(tokens, (token: Token) => {
    if (token.type !== 'link' && token.type !== 'image') return
    const linkToken = token.type === 'link' ? (token as Tokens.Link) : null
    const imageToken = token.type === 'image' ? (token as Tokens.Image) : null

    const fileTarget = getMarkdownFileTarget(token.href)
    if (fileTarget) {
      references.push({
        kind: 'file',
        label:
          (linkToken
            ? getMarkdownFileLinkLabel(linkToken, fileTarget.line)
            : getImageLabel(imageToken!, fileTarget.displayPath)) || fileTarget.displayPath,
        ...fileTarget
      })
      return
    }

    const href = getExternalLinkHref(token.href)
    if (!href) return

    references.push({
      kind: 'link',
      href,
      label: linkToken ? getLinkLabel(linkToken, href) : getImageLabel(imageToken!, href)
    })
  })

  return references
}

const getMarkdownReferences = (message: ProviderMessage): RecentChatReference[] => {
  if (!message.content.trim() || message.contentLoaded === false) return []
  // Cache by content, not provider-object identity: IPC creates fresh snapshots.
  // Attach identity afterward so identical text in other messages stays correct.
  return markdownReferenceCache
    .get(message.content, () => extractMarkdownReferences(message.content))
    .map((reference) => ({ ...reference, messageId: message.id, role: message.role }))
}

const getAttachmentReferences = (message: ProviderMessage): RecentChatFileReference[] =>
  (message.attachments ?? []).flatMap((attachment) => {
    if (attachment.kind === 'review') {
      return attachment.comments.map((comment) => ({
        kind: 'file' as const,
        path: comment.path,
        displayPath: comment.path,
        label: comment.path.split(/[\\/]/).at(-1) ?? comment.path,
        line: comment.line,
        endLine: comment.endLine,
        messageId: message.id,
        role: message.role
      }))
    }

    if (!attachment.path) return []
    return [
      {
        kind: 'file' as const,
        path: attachment.path,
        displayPath: attachment.path,
        label: attachment.name,
        messageId: message.id,
        role: message.role
      }
    ]
  })

export const getRecentChatReferenceKey = (reference: RecentChatReferenceKeySource): string =>
  reference.kind === 'text'
    ? `text:${reference.providerId}:${reference.chatId}:${reference.messageId}`
    : reference.kind === 'link'
      ? `link:${reference.href}`
      : `file:${reference.path.replace(/\\/g, '/')}`

export const getRecentChatReferences = (
  items: readonly ProviderChatItem[],
  messageLimit = recentChatMessageLimit
): RecentChatReference[] => {
  const boundedMessageLimit = Number.isFinite(messageLimit)
    ? Math.max(0, Math.floor(messageLimit))
    : recentChatMessageLimit
  if (boundedMessageLimit === 0) return []

  const messages = items
    .filter((item): item is ProviderMessage => item.type === 'message')
    .slice(-boundedMessageLimit)
  const seenReferences = new Set<string>()
  const references: RecentChatReference[] = []

  for (const message of messages.toReversed()) {
    for (const reference of [
      ...getMarkdownReferences(message),
      ...getAttachmentReferences(message)
    ]) {
      const key = getRecentChatReferenceKey(reference)
      if (seenReferences.has(key)) continue
      seenReferences.add(key)
      references.push(reference)
    }
  }

  return references
}
