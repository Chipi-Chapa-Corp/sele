import type {
  ProviderAccountRateLimitResetCredit,
  ProviderAccountRateLimitResetOutcome
} from '../../shared/provider'

export type RateLimitResetExpirationGroup = {
  expiresAt: number | null
  count: number
}

const toTimestampMilliseconds = (timestamp: number): number =>
  timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000

const getLocalDateKey = (timestamp: number): string => {
  const date = new Date(toTimestampMilliseconds(timestamp))
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export const groupRateLimitResetCreditsByExpiration = (
  credits: ProviderAccountRateLimitResetCredit[] | null
): RateLimitResetExpirationGroup[] => {
  if (!credits) return []

  const groups = new Map<string, RateLimitResetExpirationGroup>()
  for (const credit of credits) {
    const key = credit.expiresAt == null ? 'none' : getLocalDateKey(credit.expiresAt)
    const group = groups.get(key)
    if (group) {
      group.count += 1
    } else {
      groups.set(key, { expiresAt: credit.expiresAt, count: 1 })
    }
  }

  return [...groups.values()].sort((first, second) => {
    if (first.expiresAt == null) return second.expiresAt == null ? 0 : 1
    if (second.expiresAt == null) return -1
    return first.expiresAt - second.expiresAt
  })
}

export const formatRateLimitResetExpirationDate = (expiresAt: number | null): string => {
  if (expiresAt == null) return 'No expiration'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(toTimestampMilliseconds(expiresAt)))
}

export const getRateLimitResetMessage = (outcome: ProviderAccountRateLimitResetOutcome): string => {
  if (outcome === 'reset') return 'Rate limits reset.'
  if (outcome === 'nothingToReset') return 'There is no used limit to reset.'
  if (outcome === 'noCredit') return 'No reset credits are available.'
  return 'That reset credit was already used.'
}
