export const getRenderableText = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

export const getOptionalRenderableText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null
