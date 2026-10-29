import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderSubagent, ProviderChatTurnPagination } from '../../../shared/provider'
import type { ProviderChatTurnCursorWindow } from '../ProviderAdapter'
import { ClaudeHistoryPages } from './ClaudeHistoryPages.ts'
import type { ClaudeHistorySource } from './ClaudeHistorySource.ts'
import { createClaudeSubagentSummary, type ClaudeSubagentSpawn } from './ClaudeSubagents.ts'

const summaryBytes = 16 * 1024

/** Child summaries read a fixed-size header, and child transcripts use the same range reader as chats. */
export class ClaudeSubagentHistory {
  private pages = new ClaudeHistoryPages()
  private summaries = new Map<string, { signature: string; summary: ProviderSubagent }>()

  clear(): void {
    this.pages.clear()
    this.summaries.clear()
  }

  read(
    chatId: string,
    agentId: string,
    scope: string,
    window: ProviderChatTurnCursorWindow,
    openSource: () => Promise<ClaudeHistorySource>
  ) {
    return this.pages.read(chatId, `${scope}:subagent:${agentId}`, window, openSource, true)
  }

  rememberItems(pagination: ProviderChatTurnPagination, items: readonly { id: string }[]): void {
    this.pages.rememberItems(pagination, items)
  }

  findItemCursor(chatId: string, agentId: string, scope: string, itemId: string): string | null {
    return this.pages.findItemCursor(chatId, `${scope}:subagent:${agentId}`, itemId)
  }

  async summary(
    chatId: string,
    agentId: string,
    scope: string,
    openSource: () => Promise<ClaudeHistorySource>,
    spawns: ReadonlyMap<string, ClaudeSubagentSpawn>,
    metadata?: unknown
  ): Promise<ProviderSubagent> {
    const source = await openSource()
    try {
      const key = `${scope}:${chatId}:${agentId}`
      const signature = JSON.stringify([
        source.identity,
        source.size,
        source.modified,
        source.version,
        metadata,
        [...spawns]
      ])
      const saved = this.summaries.get(key)
      if (saved?.signature === signature) return saved.summary
      const head = await source.read(0, Math.min(source.size, summaryBytes))
      const text = head.toString('utf8')
      const lines = text.split('\n')
      if (head.length < source.size || !text.endsWith('\n')) lines.pop()
      const messages: SessionMessage[] = []
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line)
          if (entry.type !== 'user' && entry.type !== 'assistant') continue
          // Summary discovery never retains tool bodies or historical responses.
          const content = entry.type === 'user' ? entry.message?.content : ''
          const prompt =
            typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content
                    .filter((block) => block?.type === 'text')
                    .map((block) => block.text)
                    .join('\n')
                : ''
          messages.push({
            ...entry,
            session_id: chatId,
            message: { role: entry.type, content: prompt.slice(0, 500) }
          } as SessionMessage)
        } catch (error) {
          console.error('Unable to parse a Claude subagent summary header.', error)
        }
      }
      const summary = {
        ...createClaudeSubagentSummary(agentId, messages, spawns, metadata),
        updatedAt: source.modified
      }
      this.summaries.set(key, { signature, summary })
      while (this.summaries.size > 1000) this.summaries.delete(this.summaries.keys().next().value!)
      return summary
    } finally {
      await source.close()
    }
  }
}
