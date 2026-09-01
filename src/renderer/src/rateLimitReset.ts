import type { ProviderAccountRateLimitResetOutcome } from '../../shared/provider'

export const getRateLimitResetMessage = (outcome: ProviderAccountRateLimitResetOutcome): string => {
  if (outcome === 'reset') return 'Rate limits reset.'
  if (outcome === 'nothingToReset') return 'There is no used limit to reset.'
  if (outcome === 'noCredit') return 'No reset credits are available.'
  return 'That reset credit was already used.'
}
