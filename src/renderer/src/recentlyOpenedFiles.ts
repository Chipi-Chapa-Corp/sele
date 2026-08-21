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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isOptionalPositiveInteger = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) > 0)

const isRecentlyOpenedFile = (value: unknown): value is RecentlyOpenedFile => {
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

export const parseRecentlyOpenedFiles = (value: unknown): RecentlyOpenedFilesByWorkspace => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const parsedFiles: RecentlyOpenedFilesByWorkspace = {}
  Object.entries(value)
    .slice(-200)
    .forEach(([workspaceKey, files]) => {
      if (!workspaceKey || !Array.isArray(files)) return

      const seenFiles = new Set<string>()
      const validFiles = files
        .filter(isRecentlyOpenedFile)
        .filter((file) => {
          const key = getRecentChatReferenceKey(file)
          if (seenFiles.has(key)) return false
          seenFiles.add(key)
          return true
        })
        .slice(0, recentlyOpenedFilesStoredLimit)
      if (validFiles.length > 0) parsedFiles[workspaceKey] = validFiles
    })

  return parsedFiles
}

export const readStoredRecentlyOpenedFiles = (): RecentlyOpenedFilesByWorkspace => {
  try {
    const storedValue = window.localStorage.getItem(recentlyOpenedFilesStorageKey)
    return storedValue ? parseRecentlyOpenedFiles(JSON.parse(storedValue)) : {}
  } catch {
    return {}
  }
}

export const writeStoredRecentlyOpenedFiles = (
  filesByWorkspace: RecentlyOpenedFilesByWorkspace
): void => {
  try {
    if (Object.keys(filesByWorkspace).length === 0) {
      window.localStorage.removeItem(recentlyOpenedFilesStorageKey)
      return
    }

    window.localStorage.setItem(recentlyOpenedFilesStorageKey, JSON.stringify(filesByWorkspace))
  } catch {
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
