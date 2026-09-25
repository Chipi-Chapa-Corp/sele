import {
  getSessionMessages,
  importSessionToStore,
  type SessionStore,
  type SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeTranscriptMessage } from './ClaudeItemRenderers.ts'

/** Read display history without changing the compacted transcript Claude uses to resume. */
export const loadClaudeHistory = async (
  sessionId: string,
  sessionStore?: SessionStore
): Promise<ClaudeTranscriptMessage[]> => {
  const localEntries: SessionStoreEntry[] = []
  if (!sessionStore) {
    // Let the SDK locate the local transcript, including custom config directories.
    // The destination is memory only; neither the transcript nor the resume state is rewritten.
    await importSessionToStore(
      sessionId,
      {
        append: async (_key, entries) => {
          localEntries.push(...entries)
        },
        load: async () => null
      },
      { includeSubagents: false }
    )
  }

  const originals = new Map<string, SessionStoreEntry>()
  const messages = await getSessionMessages(sessionId, {
    includeSystemMessages: true,
    sessionStore: {
      append: async () => {
        throw new Error('Claude display history is read-only')
      },
      load: async (key) => {
        const entries = sessionStore ? await sessionStore.load(key) : localEntries
        if (!entries) return null
        return entries
          .filter((entry) => !entry.isSidechain && !entry.teamName)
          .map((entry) => {
            if (typeof entry.uuid === 'string') originals.set(entry.uuid, entry)
            if (entry.type !== 'system' || entry.subtype !== 'compact_boundary') return entry
            return {
              ...entry,
              // Compaction starts a new model-context chain. The logical parent retains the
              // link to earlier conversation history for display, including earlier compactions.
              parentUuid: entry.logicalParentUuid ?? entry.parentUuid,
              isMeta: false,
              // The SDK otherwise relocates preserved messages into the new context chain,
              // dropping their original ancestry (and potentially creating a cycle here).
              compactMetadata: undefined
            }
          })
      }
    }
  })

  return messages.map((message): ClaudeTranscriptMessage => {
    const original = originals.get(message.uuid)
    return {
      type: message.type,
      uuid: message.uuid,
      session_id: message.session_id,
      parent_tool_use_id: message.parent_tool_use_id,
      // SDK SessionMessage omits top-level system payloads and internal user flags.
      message: original?.type === 'system' ? original : message.message,
      ...(original?.isMeta === true ? { isMeta: true } : {}),
      ...(original?.isSynthetic === true ? { isSynthetic: true } : {}),
      ...(original?.isCompactSummary === true ? { isCompactSummary: true } : {}),
      ...(typeof original?.timestamp === 'string' ? { timestamp: original.timestamp } : {}),
      ...(original && 'tool_use_result' in original
        ? { tool_use_result: original.tool_use_result }
        : {})
    }
  })
}
