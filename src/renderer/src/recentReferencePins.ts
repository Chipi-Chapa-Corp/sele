import { isProviderId } from '../../shared/provider.ts'
import {
  getRecentChatReferenceKey,
  type PinnedChatTextReference,
  type RecentChatReference
} from './chatRecents.ts'
import type { RecentlyOpenedFile } from './recentlyOpenedFiles.ts'

export type PinnedRecentReference =
  RecentChatReference | RecentlyOpenedFile | PinnedChatTextReference

export type PinnedRecentChatReferencesByChat = Record<string, PinnedRecentReference[]>

export type DisplayedRecentChatReferences = {
  pinnedReferences: PinnedRecentReference[]
  recentReferences: RecentChatReference[]
}

export const pinnedRecentChatReferencesStorageKey = 'sele:pinned-chat-references:v1'

const externalLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isOptionalPositiveInteger = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) > 0)

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

const isSupportedExternalHref = (value: string): boolean => {
  try {
    return externalLinkProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

const isPinnedRecentReference = (value: unknown): value is PinnedRecentReference => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Partial<PinnedRecentReference>

  if (reference.kind === 'text') {
    return (
      isNonEmptyString(reference.chatId) &&
      isNonEmptyString(reference.content) &&
      isNonEmptyString(reference.messageId) &&
      isProviderId(reference.providerId) &&
      (reference.role === 'user' || reference.role === 'assistant') &&
      isNonNegativeInteger(reference.turnIndex)
    )
  }

  const labeledReference = reference as Partial<RecentChatReference | RecentlyOpenedFile>
  if (!isNonEmptyString(labeledReference.label)) return false

  if (reference.kind === 'link') {
    return (
      isNonEmptyString(reference.messageId) &&
      (reference.role === 'user' || reference.role === 'assistant') &&
      isNonEmptyString(reference.href) &&
      isSupportedExternalHref(reference.href)
    )
  }

  return (
    reference.kind === 'file' &&
    isNonEmptyString(reference.path) &&
    isNonEmptyString(reference.displayPath) &&
    isOptionalPositiveInteger(reference.line) &&
    isOptionalPositiveInteger(reference.endLine)
  )
}

export const parsePinnedRecentChatReferences = (
  value: unknown
): PinnedRecentChatReferencesByChat => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const parsedReferences: PinnedRecentChatReferencesByChat = {}
  Object.entries(value)
    .slice(-200)
    .forEach(([chatKey, references]) => {
      if (!chatKey || !Array.isArray(references)) return

      const seenReferences = new Set<string>()
      const validReferences = references
        .filter(isPinnedRecentReference)
        .filter((reference) => {
          const key = getRecentChatReferenceKey(reference)
          if (seenReferences.has(key)) return false
          seenReferences.add(key)
          return true
        })
        .slice(0, 100)
      if (validReferences.length > 0) parsedReferences[chatKey] = validReferences
    })

  return parsedReferences
}

export const readStoredPinnedRecentChatReferences = (): PinnedRecentChatReferencesByChat => {
  try {
    const storedValue = window.localStorage.getItem(pinnedRecentChatReferencesStorageKey)
    return storedValue ? parsePinnedRecentChatReferences(JSON.parse(storedValue)) : {}
  } catch {
    return {}
  }
}

export const writeStoredPinnedRecentChatReferences = (
  referencesByChat: PinnedRecentChatReferencesByChat
): void => {
  try {
    if (Object.keys(referencesByChat).length === 0) {
      window.localStorage.removeItem(pinnedRecentChatReferencesStorageKey)
      return
    }

    window.localStorage.setItem(
      pinnedRecentChatReferencesStorageKey,
      JSON.stringify(referencesByChat)
    )
  } catch {
    // Pinned references are non-critical; ignore unavailable storage.
  }
}

export const getDisplayedRecentChatReferences = (
  pinnedReferences: readonly PinnedRecentReference[],
  currentReferences: readonly RecentChatReference[]
): DisplayedRecentChatReferences => {
  const currentReferencesByKey = new Map(
    currentReferences.map((reference) => [getRecentChatReferenceKey(reference), reference])
  )
  const pinnedReferenceKeys = new Set(
    pinnedReferences.map((reference) => getRecentChatReferenceKey(reference))
  )

  return {
    pinnedReferences: pinnedReferences.map(
      (reference) => currentReferencesByKey.get(getRecentChatReferenceKey(reference)) ?? reference
    ),
    recentReferences: currentReferences.filter(
      (reference) => !pinnedReferenceKeys.has(getRecentChatReferenceKey(reference))
    )
  }
}
