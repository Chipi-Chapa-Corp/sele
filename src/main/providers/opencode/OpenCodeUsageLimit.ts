import { isProviderUsageLimitError } from '../../../shared/providerErrors.ts'
import { getOpenCodeFreeLimitSignal } from './OpenCodeFreeLimit.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** OpenCode retries provider limits internally; these must end the turn in Sele. */
export const getOpenCodeUsageLimitMessage = (
  type: string,
  properties: Record<string, unknown>
): string | null => {
  const status = type === 'session.status' && isRecord(properties.status) ? properties.status : null
  const info = type === 'message.updated' && isRecord(properties.info) ? properties.info : null
  const error = type === 'session.error' ? properties.error : info?.error
  const record = isRecord(error) ? error : null
  const data = isRecord(record?.data) ? record.data : null
  const action = isRecord(status?.action) ? status.action : null
  const message = [
    status?.message,
    action?.message,
    data?.message,
    record?.message,
    typeof error === 'string' ? error : null
  ].find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  // Ignore unrelated events and ordinary message text.
  if (!(status?.type === 'retry' || error != null)) return null
  if (
    getOpenCodeFreeLimitSignal(type, properties) ||
    isProviderUsageLimitError(error) ||
    (status?.type === 'retry' && isProviderUsageLimitError({ message, error: action }))
  )
    return `OpenCode usage limit reached.${message ? ` ${message.trim()}` : ''}`
  return null
}
