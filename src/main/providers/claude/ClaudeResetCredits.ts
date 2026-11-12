import type {
  ProviderAccountRateLimitResetCredits,
  ProviderAccountRateLimitResetOutcome
} from '../../../shared/provider'
import { ClaudeAuthenticationError } from './ClaudeAuthentication.ts'

const grantIdPattern = /^[a-z0-9_-]{1,40}$/
const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const timestamp = (value: unknown): number | null =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null

/** Banked grants are separate from the timestamps for ordinary rolling windows. */
export const mapClaudeResetCredits = (
  limits: unknown,
  now = Date.now()
): ProviderAccountRateLimitResetCredits | null => {
  const block = record(record(limits)?.cedar_ember)
  if (!block || typeof block.eligible !== 'boolean') return null
  const credits: NonNullable<ProviderAccountRateLimitResetCredits['credits']> = []
  const options: NonNullable<ProviderAccountRateLimitResetCredits['options']> = []
  const seen = new Set<string>()
  if (block.eligible && Array.isArray(block.grants)) {
    for (const raw of block.grants) {
      const grant = record(raw)
      if (
        !grant ||
        typeof grant.id !== 'string' ||
        !grantIdPattern.test(grant.id) ||
        seen.has(grant.id)
      )
        continue
      seen.add(grant.id)
      const count = grant.resets_left
      const startsAt = timestamp(grant.starts_at)
      const expiresAt = timestamp(grant.ends_at)
      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        count > 1000 ||
        grant.paused === true ||
        (grant.starts_at != null && (startsAt == null || startsAt > now)) ||
        (grant.ends_at != null && (expiresAt == null || expiresAt <= now))
      )
        continue
      const clears = Array.isArray(grant.clears) ? grant.clears : []
      const kind =
        grant.gives_back_weekly === true
          ? 'fable'
          : ['session', 'weekly', 'full'].includes(String(grant.type))
            ? grant.type
            : clears.includes('five_hour') && clears.length === 1
              ? 'session'
              : clears.length && !clears.includes('five_hour')
                ? 'weekly'
                : 'full'
      const [label, description] =
        kind === 'fable'
          ? [
              'Fable reset',
              'Restores Fable usage on your weekly limit and refills your five-hour limit, if present. Other weekly usage stays unchanged.'
            ]
          : kind === 'session'
            ? ['5-hour reset', 'Refills your five-hour limit.']
            : kind === 'weekly'
              ? ['Weekly reset', 'Refills your weekly limit.']
              : ['Full reset', 'Refills your five-hour and weekly limits.']
      options.push({
        id: grant.id,
        label,
        description,
        availableCount: count,
        expiresAt,
        usable: grant.usable_now === true && (timestamp(block.cooldown_until) ?? 0) <= now
      })
      for (let slot = 1; slot <= count; slot++)
        credits.push({ id: `${grant.id}:${slot}`, expiresAt })
    }
  }
  return {
    availableCount: credits.length,
    credits,
    options,
    nextCreditId: typeof block.next_grant_id === 'string' ? block.next_grant_id : undefined
  }
}

export const claudeUsageHeaders = (token: string, version: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
  'User-Agent': `claude-cli/${version} (external, cli)`
})

const claudeResetRequest = async (
  token: string,
  version: string,
  url: string,
  fetchFn: typeof fetch,
  body?: object
): Promise<Record<string, unknown> | null> => {
  let response: Response
  try {
    response = await fetchFn(url, {
      method: body ? 'POST' : 'GET',
      headers: claudeUsageHeaders(token, version),
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(25_000)
    })
  } catch {
    throw new Error('Unable to confirm the Claude reset. Try again to check the same request.')
  }
  if (response.status === 401 || response.status === 403)
    throw new ClaudeAuthenticationError('Sign in to Claude again to use banked resets.')
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Claude resets are rate limited. Try again shortly.'
        : 'Unable to confirm the Claude reset. Try again to check the same request.'
    )
  try {
    return record(await response.json())
  } catch {
    return null
  }
}

/** Resolve identity through the selected bearer, never shared .claude.json metadata. */
export const readClaudeResetAccount = async (
  token: string,
  version: string,
  fetchFn: typeof fetch = fetch
): Promise<{ organization: string; account: string }> => {
  const profile = await claudeResetRequest(
    token,
    version,
    'https://api.anthropic.com/api/oauth/profile',
    fetchFn
  )
  const organization = record(profile?.organization)?.uuid ?? profile?.organization_uuid
  const account = record(profile?.account)?.uuid
  if (
    typeof organization !== 'string' ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(organization) ||
    typeof account !== 'string' ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(account)
  )
    throw new Error('Unable to identify the Claude account organization.')
  return { organization, account }
}

/** The request ID must be retained for retries after an unanswered claim. */
export const consumeClaudeResetCredit = async (
  token: string,
  version: string,
  organization: string,
  grantId: string,
  requestId: string,
  fetchFn: typeof fetch = fetch
): Promise<ProviderAccountRateLimitResetOutcome> => {
  if (
    !grantIdPattern.test(grantId) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(requestId) ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(organization)
  )
    throw new Error('Invalid Claude reset request.')
  const result = await claudeResetRequest(
    token,
    version,
    `https://api.anthropic.com/api/organizations/${encodeURIComponent(organization)}/reset_rate_limits`,
    fetchFn,
    { program: 'cedar_ember', grant_id: grantId, request_id: requestId }
  )
  switch (result?.result) {
    case 'reset':
      return 'reset'
    case 'not_limited':
      return 'nothingToReset'
    case 'already_used':
      return 'alreadyRedeemed'
    case 'ineligible':
      return 'noCredit'
    case 'cooldown':
      throw new Error('Claude resets are cooling down. Try again later.')
    default:
      throw new Error('Unable to confirm the Claude reset. Try again to check the same request.')
  }
}
