import { preferences as preferenceStorage } from './preferences.ts'
import { getRecentChatReferenceKey, type RecentChatReferenceKeySource } from './chatRecents.ts'

export type RecentlyOpenedFile = {
  kind: 'file'
  path: string
  displayPath: string
  label: string
  line?: number
  endLine?: number
}

export type RecentlyOpenedFilesByWorkspace = Record<string, RecentlyOpenedFile[]>

export const recentlyOpenedFilesStorageKey = 'sele:recently-opened-files:v1'
export const recentlyOpenedFilesStoredLimit = 50

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isOptionalPositiveInteger = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) > 0)

export const isRecentlyOpenedFile = (value: unknown): value is RecentlyOpenedFile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const file = value as Partial<RecentlyOpenedFile>
  return (
    file.kind === 'file' &&
    isNonEmptyString(file.path) &&
    isNonEmptyString(file.displayPath) &&
    isNonEmptyString(file.label) &&
    isOptionalPositiveInteger(file.line) &&
    isOptionalPositiveInteger(file.endLine)
  )
}

export const parseStoredReferences = <Reference extends RecentChatReferenceKeySource>(
  value: unknown,
  isReference: (value: unknown) => value is Reference,
  limit: number
): Record<string, Reference[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const parsedReferences: Record<string, Reference[]> = {}
  Object.entries(value)
    .slice(-200)
    .forEach(([storageKey, references]) => {
      if (!storageKey || !Array.isArray(references)) return

      const seenReferences = new Set<string>()
      const validReferences = references
        .filter(isReference)
        .filter((reference) => {
          const key = getRecentChatReferenceKey(reference)
          if (seenReferences.has(key)) return false
          seenReferences.add(key)
          return true
        })
        .slice(0, limit)
      if (validReferences.length > 0) parsedReferences[storageKey] = validReferences
    })

  return parsedReferences
}

export const readStoredRecentlyOpenedFiles = (): RecentlyOpenedFilesByWorkspace => {
  try {
    const storedValue = preferenceStorage.getItem(recentlyOpenedFilesStorageKey)
    return storedValue
      ? parseStoredReferences(
          JSON.parse(storedValue),
          isRecentlyOpenedFile,
          recentlyOpenedFilesStoredLimit
        )
      : {}
  } catch (error) {
    console.error('[caught:recentlyOpenedFiles:readStoredRecentlyOpenedFiles]', error)
    return {}
  }
}

export const writeStoredRecentlyOpenedFiles = (
  filesByWorkspace: RecentlyOpenedFilesByWorkspace
): void => {
  try {
    if (Object.keys(filesByWorkspace).length === 0) {
      preferenceStorage.removeItem(recentlyOpenedFilesStorageKey)
      return
    }

    preferenceStorage.setItem(recentlyOpenedFilesStorageKey, JSON.stringify(filesByWorkspace))
  } catch (error) {
    console.error('[caught:recentlyOpenedFiles:writeStoredRecentlyOpenedFiles]', error)
    // Recently opened files are non-critical; ignore unavailable storage.
  }
}

export const addRecentlyOpenedFile = (
  files: readonly RecentlyOpenedFile[],
  file: RecentlyOpenedFile
): RecentlyOpenedFile[] => {
  const fileKey = getRecentChatReferenceKey(file)
  return [
    file,
    ...files.filter((candidate) => getRecentChatReferenceKey(candidate) !== fileKey)
  ].slice(0, recentlyOpenedFilesStoredLimit)
}

export const getDisplayedRecentlyOpenedFiles = (
  files: readonly RecentlyOpenedFile[],
  excludedReferences: readonly RecentChatReferenceKeySource[],
  limit: number
): RecentlyOpenedFile[] => {
  const excludedKeys = new Set(excludedReferences.map(getRecentChatReferenceKey))
  return files
    .filter((file) => !excludedKeys.has(getRecentChatReferenceKey(file)))
    .slice(0, Math.max(0, Math.floor(limit)))
}
