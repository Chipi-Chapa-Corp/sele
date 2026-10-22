import { getOpenCodeFreeLimitSignal } from './OpenCodeFreeLimit.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const limitPattern =
  /\b429\b|too many requests|rate[ _-]?limit|usage[ _-]?limit|FreeUsageLimitError|free usage exceeded|(?:exceed|exhaust|deplet).*quota|(?:quota|credits?|balance).*(?:exceed|exhaust|deplet|insufficient)|(?:insufficient[ _-]?|out of )(?:quota|credits?|balance)|(?:usage|spending|billing)[ _-]?(?:cap|limit).*(?:reach|exceed)|(?:limit|quota).*(?:resets?\b|try again in)|(?:hit|reached) (?:your|the) limit|(?:not enough|insufficient) credits|credit balance is too low|subscription required/i

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
  const message = [status?.message, action?.message, data?.message, record?.message].find(
    (value): value is string => typeof value === 'string' && Boolean(value.trim())
  )
  const text = [message, action?.reason, record?.name, record?.type, data?.responseBody]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
  // Ignore unrelated events and ordinary message text.
  if (!(status?.type === 'retry' || record)) return null
  if (
    getOpenCodeFreeLimitSignal(type, properties) ||
    data?.statusCode === 429 ||
    limitPattern.test(text)
  )
    return `OpenCode usage limit reached.${message ? ` ${message.trim()}` : ''}`
  return null
}
