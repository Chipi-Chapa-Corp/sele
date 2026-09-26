import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'

const maxFallbackTitleLength = 80

const truncate = (value: string, limit: number): string =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value

export const getClaudeSessionTitle = (
  metadata: Pick<SDKSessionInfo, 'customTitle' | 'firstPrompt'> | null,
  firstUserText = ''
): string => {
  const customTitle = metadata?.customTitle?.trim()
  if (customTitle) return customTitle

  const firstPrompt = (metadata?.firstPrompt || firstUserText).trim()
  const command = firstPrompt.match(/<command-name>(\/[\w:-]+)<\/command-name>/)?.[1]
  const title = command || firstPrompt
  if (!title) return 'Claude session'

  const commandOnly = title.match(/^\/[\w:-]+$/)
  if (commandOnly) {
    const name = title.slice(1).split(':').at(-1) ?? title.slice(1)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  return truncate(title, maxFallbackTitleLength)
}
