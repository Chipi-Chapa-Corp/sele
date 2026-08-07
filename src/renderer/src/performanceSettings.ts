export const appMaxChatsRenderedDefault = 20
export const appMaxChatsRenderedMin = 1
export const appMaxChatsRenderedMax = 100

export const normalizeAppMaxChatsRendered = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return appMaxChatsRenderedDefault
  }

  return Math.min(Math.max(Math.floor(value), appMaxChatsRenderedMin), appMaxChatsRenderedMax)
}
