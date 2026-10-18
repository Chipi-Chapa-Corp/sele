import type { OpencodeClient, Provider } from '@opencode-ai/sdk/v2'
import type { ProviderConnectionStatus } from '../../../shared/providerConnections'
import { getOpenCodeErrorMessage, isOpenCodeAbortError } from './OpenCodeItemRenderers.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const credentialErrorTypes = new Set(['authentication_error', 'permission_error'])
const credentialMessage = /\b(?:api[\s_-]?key|credential|unauthori[sz]ed|authenticat)/i

const getResponseErrorType = (body: unknown): string | null => {
  if (typeof body !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.type === 'string'
      ? parsed.error.type
      : null
  } catch {
    return null
  }
}

/**
 * True when a failed request blames the credential itself. Providers disagree on status codes:
 * an expired key is a 401, but an organization-level Anthropic key without a workspace is a 400.
 * 400/403 only count when the provider says the problem is authentication or the key.
 */
export const isOpenCodeCredentialError = (error: unknown): boolean => {
  if (!isRecord(error)) return false
  if (error.name === 'ProviderAuthError') return true
  if (error.name !== 'APIError' || !isRecord(error.data)) return false
  const { statusCode, message, responseBody } = error.data
  if (statusCode === 401) return true
  if (statusCode !== 400 && statusCode !== 403) return false
  const type = getResponseErrorType(responseBody)
  return (
    (type !== null && credentialErrorTypes.has(type)) ||
    (typeof message === 'string' && credentialMessage.test(message))
  )
}

// Provider messages can quote part of a key; drop anything token-shaped before it reaches the UI.
export const sanitizeOpenCodeCredentialMessage = (message: string): string => {
  const clean = message
    .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length <= 300 ? clean : `${clean.slice(0, 297).trimEnd()}...`
}

const isFree = (model: Provider['models'][string]): boolean =>
  model.cost.input === 0 && model.cost.output === 0

/** The cheapest usable text model, so a check costs as little as the provider allows. */
export const selectOpenCodeCheckModel = (provider: Provider): string | null => {
  const candidates = Object.values(provider.models).filter(
    (model) =>
      model.status !== 'deprecated' &&
      model.capabilities.input.text &&
      model.capabilities.output.text
  )
  candidates.sort(
    (a, b) =>
      Number(isFree(b)) - Number(isFree(a)) ||
      a.cost.input + a.cost.output - (b.cost.input + b.cost.output)
  )
  return candidates[0]?.id ?? null
}

export type OpenCodeCredentialCheckRequest = {
  client: OpencodeClient
  directory: string
  providerId: string
  onSession?: (sessionId: string) => void
  timeoutMs?: number
}

/** Sends one tiny prompt through OpenCode with the provider's stored credential. */
export const checkOpenCodeCredential = async ({
  client,
  directory,
  providerId,
  onSession,
  timeoutMs = 30_000
}: OpenCodeCredentialCheckRequest): Promise<ProviderConnectionStatus> => {
  const checkedAt = Date.now()
  const signal = AbortSignal.timeout(timeoutMs)
  let sessionId: string | null = null
  try {
    const catalog = (await client.provider.list({ directory }, { throwOnError: true, signal })).data
    const provider = catalog.all.find((entry) => entry.id === providerId)
    const modelId = provider ? selectOpenCodeCheckModel(provider) : null
    if (!modelId)
      return {
        state: 'unverified',
        message: 'OpenCode lists no model to test this connection with.',
        checkedAt
      }
    const session = (
      await client.session.create(
        {
          directory,
          title: 'Sele connection check',
          metadata: { sele: { purpose: 'oneShot' } },
          permission: [{ permission: '*', pattern: '*', action: 'deny' }]
        },
        { throwOnError: true, signal }
      )
    ).data
    sessionId = session.id
    onSession?.(session.id)
    const result = (
      await client.session.prompt(
        {
          sessionID: session.id,
          directory,
          // The title agent has a short prompt and no tools, which keeps the check cheap.
          agent: 'title',
          model: { providerID: providerId, modelID: modelId },
          system: 'Reply with the single word OK.',
          parts: [{ type: 'text', text: 'OK?' }]
        },
        { throwOnError: true, signal }
      )
    ).data
    const error = result.info.role === 'assistant' ? result.info.error : undefined
    if (!error) return { state: 'verified', checkedAt }
    if (isOpenCodeAbortError(error))
      return { state: 'unverified', message: 'The check was interrupted.', checkedAt }
    const message = sanitizeOpenCodeCredentialMessage(getOpenCodeErrorMessage(error))
    // A rate limit or provider outage says nothing about whether the credential is good.
    const transient =
      isRecord(error) &&
      error.name === 'APIError' &&
      isRecord(error.data) &&
      (error.data.statusCode === 429 || error.data.isRetryable === true)
    return transient
      ? { state: 'unverified', message, checkedAt }
      : { state: 'failed', message, checkedAt }
  } catch {
    return {
      state: 'unverified',
      message: signal.aborted
        ? 'The provider did not answer in time.'
        : 'OpenCode could not run the check.',
      checkedAt
    }
  } finally {
    if (sessionId) {
      const parameters = { sessionID: sessionId, directory }
      const cleanup = { throwOnError: true as const, signal: AbortSignal.timeout(5000) }
      await client.session.abort(parameters, cleanup).catch(() => undefined)
      await client.session
        .delete(parameters, cleanup)
        .catch((error) => console.error('[OpenCodeCredentialHealth] Unable to remove check', error))
    }
  }
}

/** Last known state of each provider's credential, per OpenCode target. */
export class OpenCodeCredentialHealth {
  private statuses = new Map<string, Map<string, ProviderConnectionStatus>>()

  /** Learn from a real reply: a credential failure or a completed reply updates the status. */
  record = (targetKey: string, message: unknown): void => {
    if (!isRecord(message) || message.role !== 'assistant') return
    const providerId = message.providerID
    if (typeof providerId !== 'string' || !providerId) return
    if (message.error) {
      if (!isOpenCodeCredentialError(message.error)) return
      this.set(targetKey, providerId, {
        state: 'failed',
        message: sanitizeOpenCodeCredentialMessage(getOpenCodeErrorMessage(message.error)),
        checkedAt: Date.now()
      })
    } else if (isRecord(message.time) && typeof message.time.completed === 'number') {
      this.set(targetKey, providerId, { state: 'verified', checkedAt: message.time.completed })
    }
  }

  set = (targetKey: string, providerId: string, status: ProviderConnectionStatus): void => {
    let providers = this.statuses.get(targetKey)
    if (!providers) {
      providers = new Map()
      this.statuses.set(targetKey, providers)
    }
    providers.set(providerId, status)
  }

  clear = (targetKey: string, providerId: string): void => {
    this.statuses.get(targetKey)?.delete(providerId)
  }

  get = (targetKey: string, providerId: string): ProviderConnectionStatus | undefined =>
    this.statuses.get(targetKey)?.get(providerId)
}
