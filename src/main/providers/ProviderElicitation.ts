import type { ProviderPendingUserInput, ProviderUserInputResponse } from '../../shared/provider'
import { record } from '../../shared/elicitation.ts'
import { validateElicitation } from './ElicitationValidation.ts'

/** Transport-neutral presentation; callbacks and credentials stay in the main process. */
export function createProviderElicitation(
  id: string,
  request: {
    message: string
    serverName?: string
    mode?: string
    url?: string
    requestedSchema?: unknown
  }
): ProviderPendingUserInput {
  if (!request.message?.trim()) throw new Error('Missing MCP interaction message.')
  const serverName = request.serverName || 'Connected service'
  let elicitation: NonNullable<ProviderPendingUserInput['elicitation']>
  if (!request.mode || request.mode === 'form') {
    const schema = record(request.requestedSchema)
    if (!schema) throw new Error('Invalid MCP form schema.')
    elicitation = { mode: 'form', serverName, schema: structuredClone(schema) }
  } else if (request.mode === 'url') {
    const url = new URL(request.url ?? '')
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid MCP interaction URL.')
    elicitation = { mode: 'url', serverName, url: url.href }
  } else
    elicitation = {
      mode: 'unsupported',
      serverName,
      reason: 'This service requested an unsupported interaction.'
    }
  return {
    id,
    question: request.message,
    choices: [],
    allowFreeform: false,
    isBlocking: true,
    startedAt: Date.now(),
    elicitation
  }
}

export function getProviderElicitationResult(
  pending: ProviderPendingUserInput,
  response: ProviderUserInputResponse
): {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
} {
  if (response.kind === 'cancel') return { action: 'cancel' }
  if (response.kind !== 'elicitation')
    throw new Error('This service requires an MCP interaction response.')
  if (response.action === 'decline') return { action: 'decline' }
  const interaction = pending.elicitation
  if (interaction?.mode === 'url') return { action: 'accept' }
  if (interaction?.mode !== 'form') throw new Error('This interaction cannot be accepted in Sele.')
  const content = record(response.content)
  if (!content) throw new Error('Missing form answers.')
  const error = validateElicitation(interaction.schema, content)
  if (error) throw new Error(error)
  return { action: 'accept', content }
}
