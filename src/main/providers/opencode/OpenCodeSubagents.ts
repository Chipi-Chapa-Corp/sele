import type { GlobalSession, Session } from '@opencode-ai/sdk/v2'
import type { ProviderSubagent } from '../../../shared/provider'
import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers.ts'

type OpenCodeSubagentStatus = { type?: string } | undefined

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

// The task tool titles child sessions "<description> (@<agent> subagent)"; the agent type is
// already the generic part, so the sidebar shows the description alone.
const getOpenCodeSubagentTitle = (title: string | undefined): string =>
  title?.replace(/\s*\(@[^()]+ subagent\)\s*$/, '').trim() ?? ''

export const isOpenCodeSubagentSession = (session: Session | GlobalSession): boolean =>
  Boolean(session.agent?.trim())

/**
 * Child sessions are shown only as their root chat's subagents. Publishing one as a chat update
 * would add it to the sidebar as a second, top-level chat.
 */
export const isOpenCodeChildState = (
  state: { session: Session | GlobalSession | null } | undefined
): boolean => Boolean(state?.session?.parentID)

export const createOpenCodeSubagentSummary = (
  session: Session | GlobalSession,
  rootChatId: string,
  status?: OpenCodeSubagentStatus
): ProviderSubagent => ({
  id: session.id,
  parentId: session.parentID && session.parentID !== rootChatId ? session.parentID : null,
  title: truncate(
    getOpenCodeSubagentTitle(session.title) || session.agent || `Subagent ${session.id}`,
    60
  ),
  description: session.agent?.trim() || null,
  status: status?.type === 'busy' || status?.type === 'retry' ? 'running' : 'completed',
  createdAt: Number.isFinite(session.time.created) ? session.time.created : null,
  updatedAt: Number.isFinite(session.time.updated) ? session.time.updated : null,
  // OpenCode child sessions accept prompts directly; a prompt sent mid-run joins the active loop.
  canMessage: true
})

type OpenCodeUserMessageInfo = Extract<OpenCodeMessageWithParts['info'], { role: 'user' }>

/**
 * Continue a child session with the same agent, model and tool restrictions the parent's task
 * tool gave it, rather than the root chat's composer settings.
 */
export const getOpenCodeSubagentPromptSettings = (
  session: Session | GlobalSession,
  messages: OpenCodeMessageWithParts[]
): {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  tools?: Record<string, boolean>
} => {
  const lastUser = messages.findLast(
    (
      message
    ): message is OpenCodeMessageWithParts & {
      info: OpenCodeUserMessageInfo
    } => message.info.role === 'user'
  )?.info
  const agent = lastUser?.agent?.trim() || session.agent?.trim() || undefined
  return {
    ...(agent ? { agent } : {}),
    ...(lastUser?.model
      ? {
          model: {
            providerID: lastUser.model.providerID,
            modelID: lastUser.model.modelID
          },
          ...(lastUser.model.variant ? { variant: lastUser.model.variant } : {})
        }
      : {}),
    ...(lastUser?.tools ? { tools: lastUser.tools } : {})
  }
}
