import type { ProviderChatItem } from '../../shared/provider.ts'

export const migrationNote =
  'Note: Previous dialog was managed by another agent, some tool calls were stripped.'
export const withMigrationNote = (text: string): string =>
  text.startsWith(`${migrationNote}\n`) ? text : `${migrationNote}\n${text}`

export type TranscriptMessage = { id?: string; role: 'user' | 'assistant'; content: string }
export const transcriptMessages = (items: ProviderChatItem[]): TranscriptMessage[] =>
  items.flatMap((item) =>
    item.type === 'message' && item.content.trim()
      ? [{ id: item.id, role: item.role, content: item.content }]
      : []
  )
