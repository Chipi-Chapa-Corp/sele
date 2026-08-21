export const appMaxChatsRenderedDefault = 100
export const appMaxChatsRenderedMin = 1

export const appRecentsMessageLimitDefault = 30
export const appRecentsMessageLimitMin = 1
export const appRecentsMessageLimitMax = 50

export const appRecentlyOpenedFilesLimitDefault = 5
export const appRecentlyOpenedFilesLimitMin = 0
export const appRecentlyOpenedFilesLimitMax = 50

export const normalizeAppMaxChatsRendered = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return appMaxChatsRenderedDefault
  }

  return Math.max(Math.floor(value), appMaxChatsRenderedMin)
}

export const normalizeAppRecentsMessageLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return appRecentsMessageLimitDefault
  }

  return Math.min(Math.max(Math.floor(value), appRecentsMessageLimitMin), appRecentsMessageLimitMax)
}

export const normalizeAppRecentlyOpenedFilesLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return appRecentlyOpenedFilesLimitDefault
  }

  return Math.min(
    Math.max(Math.floor(value), appRecentlyOpenedFilesLimitMin),
    appRecentlyOpenedFilesLimitMax
  )
}
