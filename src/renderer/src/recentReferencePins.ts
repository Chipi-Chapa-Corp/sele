import { preferences as preferenceStorage } from './preferences.ts'
import { isProviderId } from '../../shared/provider.ts'
import {
  getRecentChatReferenceKey,
  type PinnedChatTextReference,
  type RecentChatReference
} from './chatRecents.ts'
import {
  isNonEmptyString,
  isRecentlyOpenedFile,
  parseStoredReferences,
  type RecentlyOpenedFile
} from './recentlyOpenedFiles.ts'

export type PinnedRecentReference =
  | RecentChatReference
  | RecentlyOpenedFile
  | PinnedChatTextReference

export type PinnedRecentChatReferencesByChat = Record<string, PinnedRecentReference[]>

export type DisplayedRecentChatReferences = {
  pinnedReferences: PinnedRecentReference[]
  recentReferences: RecentChatReference[]
}

export const pinnedRecentChatReferencesStorageKey = 'sele:pinned-chat-references:v1'

const externalLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

const isSupportedExternalHref = (value: string): boolean => {
  try {
    return externalLinkProtocols.has(new URL(value).protocol)
  } catch (error) {
    console.error('[caught:recentReferencePins:isSupportedExternalHref]', error)
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

  if (reference.kind === 'link') {
    return (
      isNonEmptyString(reference.label) &&
      isNonEmptyString(reference.messageId) &&
      (reference.role === 'user' || reference.role === 'assistant') &&
      isNonEmptyString(reference.href) &&
      isSupportedExternalHref(reference.href)
    )
  }

  return isRecentlyOpenedFile(value)
}

export const readStoredPinnedRecentChatReferences = (): PinnedRecentChatReferencesByChat => {
  try {
    const storedValue = preferenceStorage.getItem(pinnedRecentChatReferencesStorageKey)
    return storedValue
      ? parseStoredReferences(JSON.parse(storedValue), isPinnedRecentReference, 100)
      : {}
  } catch (error) {
    console.error('[caught:recentReferencePins:readStoredPinnedRecentChatReferences]', error)
    return {}
  }
}

export const writeStoredPinnedRecentChatReferences = (
  referencesByChat: PinnedRecentChatReferencesByChat
): void => {
  try {
    if (Object.keys(referencesByChat).length === 0) {
      preferenceStorage.removeItem(pinnedRecentChatReferencesStorageKey)
      return
    }

    preferenceStorage.setItem(
      pinnedRecentChatReferencesStorageKey,
      JSON.stringify(referencesByChat)
    )
  } catch (error) {
    console.error('[caught:recentReferencePins:writeStoredPinnedRecentChatReferences]', error)
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
