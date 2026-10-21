import type { GlobalSession, OpencodeClient, Session } from '@opencode-ai/sdk/v2'
import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers'

export const openCodeHistoryPageSize = 32
const historyProcessingBudgetMs = 8

const yieldToApp = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Bound each HTTP response's JSON parsing, including histories with large tool outputs. */
export const loadOpenCodeMessages = async (
  client: OpencodeClient,
  session: Pick<Session | GlobalSession, 'id' | 'directory'>,
  limit?: number
): Promise<OpenCodeMessageWithParts[]> => {
  const pages: OpenCodeMessageWithParts[][] = []
  const cursors = new Set<string>()
  let before: string | undefined
  do {
    const result = await client.session.messages(
      {
        sessionID: session.id,
        directory: session.directory,
        limit: limit ?? openCodeHistoryPageSize,
        ...(before ? { before } : {})
      },
      { throwOnError: true }
    )
    pages.push(result.data)
    // Sidebar previews need only their bounded tail. Full history follows the server's
    // opaque cursor, never a guessed message ID or a page-length completion heuristic.
    if (limit != null) return result.data
    before = result.response.headers.get('x-next-cursor') || undefined
    if (before) {
      if (cursors.has(before)) throw new Error('OpenCode history pagination did not advance.')
      cursors.add(before)
      await yieldToApp()
    }
  } while (before)
  // Pages arrive newest first; records within each page are chronological.
  return pages.reverse().flat()
}

/** Usage listeners can do synchronous work; don't monopolize the app thread on cold opens. */
export const forEachOpenCodeHistoryMessage = async (
  messages: readonly OpenCodeMessageWithParts[],
  visit: (message: OpenCodeMessageWithParts) => void
): Promise<void> => {
  let started = performance.now()
  for (let index = 0; index < messages.length; index++) {
    visit(messages[index])
    if (index + 1 < messages.length && performance.now() - started >= historyProcessingBudgetMs) {
      await yieldToApp()
      started = performance.now()
    }
  }
}
