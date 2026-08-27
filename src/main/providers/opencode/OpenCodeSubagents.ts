import type { GlobalSession, Session } from '@opencode-ai/sdk/v2'
import type { ProviderSubagent } from '../../../shared/provider'

type OpenCodeSubagentStatus = { type?: string } | undefined

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

export const isOpenCodeSubagentSession = (session: Session | GlobalSession): boolean =>
  Boolean(session.agent?.trim())

export const createOpenCodeSubagentSummary = (
  session: Session | GlobalSession,
  rootChatId: string,
  status?: OpenCodeSubagentStatus
): ProviderSubagent => ({
  id: session.id,
  parentId: session.parentID && session.parentID !== rootChatId ? session.parentID : null,
  title: truncate(session.title || session.agent || `Subagent ${session.id}`, 80),
  description: session.agent?.trim() || null,
  status: status?.type === 'busy' || status?.type === 'retry' ? 'running' : 'completed',
  createdAt: Number.isFinite(session.time.created) ? session.time.created : null,
  updatedAt: Number.isFinite(session.time.updated) ? session.time.updated : null
})
